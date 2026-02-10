import * as THREE from 'three';
import {intrinsicsToProjectionMatrix} from './CameraParameterUtils';

// prettier-ignore
export const MOOHAN_INTRINSICS_MATRIX = [
  800, 0, 640,
  0, 800, 360,
  0, 0, 1,
];

export const MOOHAN_PROJECTION_MATRIX = intrinsicsToProjectionMatrix(
  MOOHAN_INTRINSICS_MATRIX,
  1280,
  720,
  0.1,
  1000,
  new THREE.Matrix4()
);

export const MOOHAN_CAMERA_POSE_IN_RIGHT_CAMERA_POSITION = new THREE.Vector3(
  0,
  -0.003,
  0
);
export const MOOHAN_CAMERA_POSE_IN_RIGHT_CAMERA_ROTATION =
  new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.02, -0.05, 0, 'YXZ'));

const MOOHAN_CAMERA_POSE_IN_RIGHT_CAMERA_SCALE = new THREE.Vector3(1, 1, 1);

// Pose of the moohan camera w.r.t. right camera.
export const MOOHAN_CAMERA_POSE_IN_RIGHT_CAMERA = new THREE.Matrix4().compose(
  MOOHAN_CAMERA_POSE_IN_RIGHT_CAMERA_POSITION,
  MOOHAN_CAMERA_POSE_IN_RIGHT_CAMERA_ROTATION,
  MOOHAN_CAMERA_POSE_IN_RIGHT_CAMERA_SCALE
);

export function getMoohanCameraPose(
  _camera: THREE.Camera,
  xrCameras: THREE.WebXRArrayCamera,
  target: THREE.Matrix4
) {
  target.compose(
    MOOHAN_CAMERA_POSE_IN_RIGHT_CAMERA_POSITION,
    MOOHAN_CAMERA_POSE_IN_RIGHT_CAMERA_ROTATION,
    MOOHAN_CAMERA_POSE_IN_RIGHT_CAMERA_SCALE
  );
  target.premultiply(xrCameras.cameras[1].matrixWorld);
}
