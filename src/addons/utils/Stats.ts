import ThreeStats from 'three/addons/libs/stats.module.js';
import * as THREE from 'three';
import * as xb from 'xrblocks';

export class Stats extends xb.Script {
  stats = new ThreeStats();
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  softHeadLock = true;
  softHeadLockOffsetPosition = new THREE.Vector3(-0.2, 0.2, -0.75);
  softHeadLockOffsetRotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(0, 0.1 * Math.PI, 0)
  );
  private targetPosition = new THREE.Vector3();
  private targetRotation = new THREE.Quaternion();
  private texture: THREE.CanvasTexture;

  constructor() {
    super();
    this.stats.showPanel(0);
    const statsCanvas = this.stats.dom.children[0] as HTMLCanvasElement;
    const geometry = new THREE.PlaneGeometry(0.15, 0.09);
    this.texture = new THREE.CanvasTexture(statsCanvas);
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: this.texture,
      })
    );
    this.add(this.mesh);
  }

  showPanel(panel: number) {
    this.stats.showPanel(panel);
    const statsCanvas = this.stats.dom.children[panel] as HTMLCanvasElement;
    this.texture.dispose();
    this.texture = new THREE.CanvasTexture(statsCanvas);
    this.mesh.material.map = this.texture;
  }

  private updateSoftHeadlockTargetPose() {
    const camera = xb.core.camera;
    this.targetPosition
      .copy(this.softHeadLockOffsetPosition)
      .applyQuaternion(camera.quaternion)
      .add(camera.position);
    this.targetRotation
      .copy(camera.quaternion)
      .multiply(this.softHeadLockOffsetRotation);
  }

  private updateSoftHeadlock() {
    this.updateSoftHeadlockTargetPose();
    const lerpFactor = 10.0 * xb.getDeltaTime();
    this.position.lerp(this.targetPosition, lerpFactor);
    this.quaternion.slerp(this.targetRotation, lerpFactor);
  }

  enableSoftHeadLock() {
    this.softHeadLock = true;
    this.updateSoftHeadlockTargetPose();
    this.position.copy(this.targetPosition);
    this.quaternion.copy(this.targetRotation);
  }

  disableSoftHeadLock() {
    this.softHeadLock = false;
  }

  override update() {
    this.texture.needsUpdate = true;
    this.stats.update();
    if (this.softHeadLock) {
      this.updateSoftHeadlock();
    }
  }
}
