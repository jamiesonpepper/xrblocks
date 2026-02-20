import * as THREE from 'three';

// Check the threejs version and log an error if it is too old.
export function checkThreeVersion() {
  if (parseInt(THREE.REVISION) < 182) {
    console.error(
      `three.js version ${THREE.REVISION} is too old. Please update to version 182 or higher.`
    );
  }
}
