import * as THREE from 'three';

import {Registry} from '../core/components/Registry';
import type {Shader} from '../utils/Types';
import {clamp} from '../utils/utils';

import {DepthMesh} from './DepthMesh';
import {DepthOptions} from './DepthOptions';
import {DepthTextures} from './DepthTextures';
import {OcclusionPass} from './occlusion/OcclusionPass';

const DEFAULT_DEPTH_WIDTH = 160;
const DEFAULT_DEPTH_HEIGHT = DEFAULT_DEPTH_WIDTH;
const clipSpacePosition = new THREE.Vector3();

export type DepthArray = Float32Array | Uint16Array;

export class Depth {
  static instance?: Depth;

  // The main camera.
  private camera!: THREE.Camera;
  private renderer!: THREE.WebGLRenderer;

  enabled = false;
  view: XRView[] = [];
  cpuDepthData: XRCPUDepthInformation[] = [];
  gpuDepthData: XRWebGLDepthInformation[] = [];
  depthArray: DepthArray[] = [];
  depthMesh?: DepthMesh;
  private depthTextures?: DepthTextures;
  options = new DepthOptions();
  width = DEFAULT_DEPTH_WIDTH;
  height = DEFAULT_DEPTH_HEIGHT;
  get rawValueToMeters() {
    if (this.cpuDepthData.length) {
      return this.cpuDepthData[0].rawValueToMeters;
    } else if (this.gpuDepthData.length) {
      return this.gpuDepthData[0].rawValueToMeters;
    }
    return 0;
  }
  occludableShaders = new Set<Shader>();
  private occlusionPass?: OcclusionPass;

  // Whether we're counting the number of depth clients.
  private depthClientsInitialized = false;
  private depthClients = new Set<object>();

  depthProjectionMatrices: THREE.Matrix4[] = [];
  depthProjectionInverseMatrices: THREE.Matrix4[] = [];
  depthViewMatrices: THREE.Matrix4[] = [];
  depthViewProjectionMatrices: THREE.Matrix4[] = [];
  depthCameraPositions: THREE.Vector3[] = [];
  depthCameraRotations: THREE.Quaternion[] = [];

  /**
   * Depth is a lightweight manager based on three.js to simply prototyping
   * with Depth in WebXR.
   */
  constructor() {
    if (Depth.instance) {
      return Depth.instance;
    }
    Depth.instance = this;
  }

  /**
   * Initialize Depth manager.
   */
  init(
    camera: THREE.PerspectiveCamera,
    options: DepthOptions,
    renderer: THREE.WebGLRenderer,
    registry: Registry,
    scene: THREE.Scene
  ) {
    this.camera = camera;
    this.options = options;
    this.renderer = renderer;
    this.enabled = options.enabled;

    if (this.options.depthTexture.enabled) {
      this.depthTextures = new DepthTextures(options);
      registry.register(this.depthTextures);
    }

    if (this.options.depthMesh.enabled) {
      this.depthMesh = new DepthMesh(
        options,
        this.width,
        this.height,
        this.depthTextures
      );
      registry.register(this.depthMesh);
      if (this.options.depthMesh.renderShadow) {
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
      }
      scene.add(this.depthMesh);
    }

    if (this.options.occlusion.enabled) {
      this.occlusionPass = new OcclusionPass(scene, camera);
    }
  }

  /**
   * Retrieves the depth at normalized coordinates (u, v).
   * @param u - Normalized horizontal coordinate.
   * @param v - Normalized vertical coordinate.
   * @returns Depth value at the specified coordinates.
   */
  getDepth(u: number, v: number) {
    if (!this.depthArray[0]) return 0.0;
    const depthX = Math.round(clamp(u * this.width, 0, this.width - 1));
    const depthY = Math.round(
      clamp((1.0 - v) * this.height, 0, this.height - 1)
    );
    const rawDepth = this.depthArray[0][depthY * this.width + depthX];
    return this.rawValueToMeters * rawDepth;
  }

  /**
   * Projects the given world position to depth camera's clip space and then
   * to the depth camera's view space using the depth.
   * @param position - The world position to project.
   * @returns The depth camera view space position.
   */
  getProjectedDepthViewPositionFromWorldPosition(
    position: THREE.Vector3,
    target = new THREE.Vector3()
  ) {
    clipSpacePosition
      .copy(position)
      .applyMatrix4(this.depthViewMatrices[0])
      .applyMatrix4(this.depthProjectionMatrices[0]);
    const u = 0.5 * (clipSpacePosition.x + 1.0);
    const v = 0.5 * (clipSpacePosition.y + 1.0);
    const depth = this.getDepth(u, v);
    target.set(2.0 * (u - 0.5), 2.0 * (v - 0.5), -1);
    target.applyMatrix4(this.depthProjectionInverseMatrices[0]);
    target.multiplyScalar(-depth / target.z);
    return target;
  }

  /**
   * Retrieves the depth at normalized coordinates (u, v).
   * @param u - Normalized horizontal coordinate.
   * @param v - Normalized vertical coordinate.
   * @returns Vertex at (u, v)
   */
  getVertex(u: number, v: number) {
    if (!this.depthArray[0]) return null;

    const depthX = Math.round(clamp(u * this.width, 0, this.width - 1));
    const depthY = Math.round(
      clamp((1.0 - v) * this.height, 0, this.height - 1)
    );
    const rawDepth = this.depthArray[0][depthY * this.width + depthX];
    const depth = this.rawValueToMeters * rawDepth;
    const vertexPosition = new THREE.Vector3(
      2.0 * (u - 0.5),
      2.0 * (v - 0.5),
      -1
    );
    vertexPosition.applyMatrix4(this.depthProjectionInverseMatrices[0]);
    vertexPosition.multiplyScalar(-depth / vertexPosition.z);
    return vertexPosition;
  }

  private updateDepthMatrices(depthData: XRDepthInformation, viewId: number) {
    // Populate depth view and projection matrices.
    while (viewId >= this.depthViewMatrices.length) {
      this.depthViewMatrices.push(new THREE.Matrix4());
      this.depthViewProjectionMatrices.push(new THREE.Matrix4());
      this.depthProjectionMatrices.push(new THREE.Matrix4());
      this.depthProjectionInverseMatrices.push(new THREE.Matrix4());
      this.depthCameraPositions.push(new THREE.Vector3());
      this.depthCameraRotations.push(new THREE.Quaternion());
    }
    if (depthData.projectionMatrix && depthData.transform) {
      this.depthProjectionMatrices[viewId].fromArray(
        depthData.projectionMatrix
      );
      this.depthViewMatrices[viewId].fromArray(
        depthData.transform.inverse.matrix
      );
      this.depthCameraPositions[viewId].set(
        depthData.transform.position.x,
        depthData.transform.position.y,
        depthData.transform.position.z
      );
      this.depthCameraRotations[viewId].set(
        depthData.transform.orientation.x,
        depthData.transform.orientation.y,
        depthData.transform.orientation.z,
        depthData.transform.orientation.w
      );
    } else {
      const camera =
        this.renderer.xr?.getCamera()?.cameras?.[viewId] ?? this.camera;
      this.depthProjectionMatrices[viewId].copy(camera.projectionMatrix);
      this.depthViewMatrices[viewId].copy(camera.matrixWorldInverse);
      this.depthCameraPositions[viewId].copy(camera.position);
      this.depthCameraRotations[viewId].copy(camera.quaternion);
    }
    this.depthProjectionInverseMatrices[viewId]
      .copy(this.depthProjectionMatrices[viewId])
      .invert();
    this.depthViewProjectionMatrices[viewId].multiplyMatrices(
      this.depthProjectionMatrices[viewId],
      this.depthViewMatrices[viewId]
    );
  }

  updateCPUDepthData(depthData: XRCPUDepthInformation, viewId = 0) {
    this.cpuDepthData[viewId] = depthData;
    this.updateDepthMatrices(depthData, viewId);

    // Updates Depth Array.
    this.depthArray[viewId] = this.options.useFloat32
      ? new Float32Array(depthData.data)
      : new Uint16Array(depthData.data);
    this.width = depthData.width;
    this.height = depthData.height;

    // Updates Depth Texture.
    if (this.options.depthTexture.enabled && this.depthTextures) {
      this.depthTextures.updateData(depthData, viewId);
    }

    if (this.options.depthMesh.enabled && this.depthMesh && viewId == 0) {
      this.depthMesh.updateDepth(
        depthData,
        this.depthProjectionInverseMatrices[0]
      );
      this.depthMesh.position.copy(this.depthCameraPositions[0]);
      this.depthMesh.quaternion.copy(this.depthCameraRotations[0]);
    }
  }

  updateGPUDepthData(depthData: XRWebGLDepthInformation, viewId = 0) {
    this.gpuDepthData[viewId] = depthData;
    this.updateDepthMatrices(depthData, viewId);

    // For now, assume that we need cpu depth only if depth mesh is enabled.
    // In the future, add a separate option.
    const needCpuDepth = this.options.depthMesh.enabled;
    const cpuDepth =
      needCpuDepth && this.depthMesh
        ? this.depthMesh.convertGPUToGPU(depthData)
        : null;
    if (cpuDepth) {
      if (this.depthArray[viewId] == null) {
        this.depthArray[viewId] = this.options.useFloat32
          ? new Float32Array(cpuDepth.data)
          : new Uint16Array(cpuDepth.data);
        this.width = cpuDepth.width;
        this.height = cpuDepth.height;
      } else {
        // Copies the data from an ArrayBuffer to the existing TypedArray.
        this.depthArray[viewId].set(
          this.options.useFloat32
            ? new Float32Array(cpuDepth.data)
            : new Uint16Array(cpuDepth.data)
        );
      }
    }

    // Updates Depth Texture.
    if (this.options.depthTexture.enabled && this.depthTextures) {
      this.depthTextures.updateNativeTexture(depthData, this.renderer, viewId);
    }

    if (this.options.depthMesh.enabled && this.depthMesh && viewId == 0) {
      if (cpuDepth) {
        this.depthMesh.updateDepth(
          cpuDepth,
          this.depthProjectionInverseMatrices[0]
        );
      } else {
        this.depthMesh.updateGPUDepth(
          depthData,
          this.depthProjectionInverseMatrices[0]
        );
      }
      this.depthMesh.position.copy(this.depthCameraPositions[0]);
      this.depthMesh.quaternion.copy(this.depthCameraRotations[0]);
    }
  }

  getTexture(viewId: number) {
    if (!this.options.depthTexture.enabled) return undefined;
    return this.depthTextures?.get(viewId);
  }

  update(frame?: XRFrame) {
    if (!this.options.enabled) return;
    if (frame) {
      this.updateLocalDepth(frame);
    }
    if (this.options.occlusion.enabled) {
      this.renderOcclusionPass();
    }
  }

  updateLocalDepth(frame: XRFrame) {
    const session = frame.session;
    const binding = this.renderer.xr.getBinding();

    // Enable or disable depth based on the number of clients.
    const pausingDepthSupported = session.depthActive !== undefined;
    if (pausingDepthSupported && this.depthClientsInitialized) {
      const needsDepth = this.depthClients.size > 0;
      if (session.depthActive && !needsDepth) {
        session.pauseDepthSensing?.();
      } else if (!session.depthActive && needsDepth) {
        session.resumeDepthSensing?.();
      }
      if (this.depthClients.size == 0) {
        return;
      }
    }

    const xrRefSpace = this.renderer.xr.getReferenceSpace();
    if (xrRefSpace) {
      const pose = frame.getViewerPose(xrRefSpace);
      if (pose) {
        for (let viewId = 0; viewId < pose.views.length; ++viewId) {
          const view = pose.views[viewId];
          this.view[viewId] = view;

          if (session.depthUsage === 'gpu-optimized') {
            const depthData = binding.getDepthInformation(view);
            if (!depthData) {
              return;
            }
            this.updateGPUDepthData(depthData, viewId);
          } else {
            const depthData = frame.getDepthInformation(view);
            if (!depthData) {
              return;
            }
            this.updateCPUDepthData(depthData, viewId);
          }
        }
      } else {
        console.error('Pose unavailable in the current frame.');
      }
    }
  }

  renderOcclusionPass() {
    const leftDepthTexture = this.getTexture(0);
    if (leftDepthTexture) {
      this.occlusionPass!.setDepthTexture(
        leftDepthTexture,
        this.rawValueToMeters,
        0,
        (this.gpuDepthData[0] as unknown as {depthNear: number} | undefined)
          ?.depthNear
      );
    }
    const rightDepthTexture = this.getTexture(1);
    if (rightDepthTexture) {
      this.occlusionPass!.setDepthTexture(
        rightDepthTexture,
        this.rawValueToMeters,
        1,
        (this.gpuDepthData[1] as unknown as {depthNear: number} | undefined)
          ?.depthNear
      );
    }
    const xrIsPresenting = this.renderer.xr.isPresenting;
    this.renderer.xr.isPresenting = false;
    this.occlusionPass!.render(this.renderer, undefined, undefined, 0);
    this.renderer.xr.isPresenting = xrIsPresenting;
    for (const shader of this.occludableShaders) {
      this.occlusionPass!.updateOcclusionMapUniforms(
        shader.uniforms,
        this.renderer
      );
    }
  }

  debugLog() {
    const arrayBuffer = this.cpuDepthData[0].data;
    const uint8Array = new Uint8Array(arrayBuffer);
    // Convert Uint8Array to a string where each character represents a byte
    const binaryString = Array.from(uint8Array, (byte) =>
      String.fromCharCode(byte)
    ).join('');
    // Convert binary string to base64
    const data_str = btoa(binaryString);
    console.log(data_str);
  }

  resumeDepth(client: object) {
    this.depthClientsInitialized = true;
    this.depthClients.add(client);
  }

  pauseDepth(client: object) {
    this.depthClientsInitialized = true;
    this.depthClients.delete(client);
  }
}
