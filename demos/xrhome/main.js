/**
 * main.js
 * Entry point for XRHome.
 */

import * as xb from 'xrblocks';
import { AuthManager } from './auth.js';
import { CameraManager } from './webrtc.js';
import { VisionManager } from './vision.js';
import { SmartHomeManager } from './smarthome.js';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { HUDManager } from './hud.js';

// Globals
const auth = new AuthManager();
const camera = new CameraManager('webrtc-video');
const vision = new VisionManager();
let smartHome = null;

// XR State
let realDevices = []; // From Google Home
let virtualLights = []; // 3D Objects in Scene
let lastScanTime = 0;
const SCAN_INTERVAL = 30000; // Scan every 30s to save tokens/rate limits
const hud = new HUDManager();
let videoPlane = null;

// Setup Configuration UI
function setupUI() {
    const overlay = document.getElementById('config-overlay');
    const startBtn = document.getElementById('start-btn');
    const geminiInput = document.getElementById('gemini-key');
    const projectInput = document.getElementById('project-id');
    const clientIdInput = document.getElementById('client-id');


    if (auth.config.geminiKey) geminiInput.value = auth.config.geminiKey;
    if (auth.config.projectId) projectInput.value = auth.config.projectId;
    if (auth.config.clientId) clientIdInput.value = auth.config.clientId;

    // Check if we can auto-start (if we have config AND maybe token)
    if (auth.hasConfig() && auth.accessToken) {
         overlay.style.display = 'none';
         initApp();
         return;
    }

    // Attempt OAuth check on load
    // Attempt OAuth check on load
    auth.authenticate().then(() => {
        console.log("Auth Check Complete. HasConfig:", auth.hasConfig(), "Token:", !!auth.accessToken);
        if (auth.hasConfig() && auth.accessToken) {
             console.log("Auto-starting app...");
             overlay.style.display = 'none';
             initApp();
        }
    });

    startBtn.addEventListener('click', () => {
        console.log("Start Button Clicked");
        const config = {
            geminiKey: geminiInput.value,
            projectId: projectInput.value,
            clientId: clientIdInput.value,
            clientSecret: document.getElementById('client-secret').value
        };
        console.log("Saving Config:", config);
        auth.saveConfig(config);
        
        // Trigger Auth
        console.log("Triggering Authenticate...");
        auth.authenticate();
    });
}

class VirtualLight extends xb.Script {
  constructor(geminiData, labelText) {
      super();
      this.geminiData = geminiData;
      this.labelText = labelText;
      this.isOn = false;
      this.brightness = 100;
  }

  onStart() {
      // Create a visual indicator (Ring)
      const geometry = new THREE.RingGeometry(0.08, 0.1, 32);
      const material = new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide });
      this.mesh = new THREE.Mesh(geometry, material);
      // Face camera
      this.mesh.lookAt(0, 1.6, 0); // Approx head height? 
      // Actually simpler to just be billboarded or parallel to Z plane.
      // Since it's on a plane, just identity rotation is fine if parent is.
      // But we are adding to world.
      this.mesh.rotation.set(0, 0, 0);
      
      this.add(this.mesh);

      // Simple Text Label (using console for now or just visual color change)
      console.log("Created Virtual Light:", this.labelText);
      
      this.lastPinch = false;
  }

  onUpdate(dt) {
      // Update position based on Camera if needed (but usually we place it once or update slowly)
      // Here we assume it's placed in world space.

      // Interaction Logic: Find closest hand
      // XRBlocks provides access to hands via `xb.get().hands` or similar?
      // Or we iterate basic controllers.
      // Let's use a simple distance check to the "Main" hand if available.
  }

  toggle() {
      this.isOn = !this.isOn;
      this.mesh.material.emissiveIntensity = this.isOn ? 1.0 : 0.2;
      this.mesh.material.color.setHex(this.isOn ? 0xffffff : 0xffff00);
      
      // Send to real device
      if (this.realDevice && smartHome) {
          smartHome.toggleLight(this.realDevice.name, this.isOn);
      }
  }

  setBrightness(val) {
      this.brightness = Math.max(0, Math.min(100, val));
      if (this.realDevice && smartHome) {
          // Debounce this ideally
          smartHome.setBrightness(this.realDevice.name, this.brightness);
      }
  }
}


// --- Main App Logic ---

async function initApp() {
    console.log("Initializing XRHome...");
    
    smartHome = new SmartHomeManager(auth);
    
    // 1. Fetch Real Devices
    try {
        const devices = await smartHome.listDevices();
        console.log("Real Devices:", devices);
        // Filter for lights
        realDevices = devices.filter(d => 
            d.type === 'sdm.devices.types.LIGHT' || 
            d.traits && d.traits['sdm.devices.traits.OnOff']
        );
    } catch (e) {
        console.error("Failed to list real devices", e);
    }

    // 2. Start Camera
    await camera.startCamera();

    // 3. Init XRBlocks
    await RAPIER.init({}); // Explicitly init with empty object to avoid warning
    const o = new xb.Options();
    o.enableUI();
    o.physics.RAPIER = RAPIER;
    o.physics.useEventQueue = true;
    o.physics.worldStep = true;
    o.hands.enabled = true; // Use Hands
    o.simulator.defaultMode = xb.SimulatorMode.POSE; // Or generic

    xb.init(o);

    // 5. Create Passthrough Plane (HUD)
    createPassthrough();
    
    // 6. Init HUD
    hud.init(xb);
    hud.log("System Initialized");

    // 7. Init Vision
    vision.init(auth.config.geminiKey);
    startVisionLoop();
}

function startVisionLoop() {
    // Handle specific status updates
    vision.onStatus = (msg) => {
        // Only log "Found" or "Error" to keep HUD clean, or simple dots?
        // Let's log everything for now to prove it works
        hud.log(msg, msg.includes("Found") ? '#00FFFF' : '#00FF00');
    };

    vision.onLightsFound = (lights) => {
        // Existing Light Creation Logic...
        // ... (We can reuse the logic, just moved here)
        spawnVirtualLights(lights);
    };

    hud.log("Vision System Started");
    
    // Poll every 1.5s (Balance between Latency and Rate Limit)
    // Flash Rate Limit is high, but let's be reasonable.
    setInterval(async () => {
        const canvas = document.getElementById('process-canvas');
        const blob = await camera.captureFrame(canvas);
        if (blob) {
            vision.analyzeFrame(blob);
        }
    }, 5000); // Poll every 5 seconds to avoid 429 Quota errors 
}

function spawnVirtualLights(lights) {
    console.log("Rebuilding Lights:", lights);
    // Clear existing
    for(let l of virtualLights) {
        if (l.parent) l.parent.remove(l);
    }
    virtualLights = [];

    let deviceIdx = 0;
    for (const l of lights) {
        // Unproject Bounding Box Center
        const cx = (l.xmin + l.xmax) / 2;
        const cy = (l.ymin + l.ymax) / 2;

        // Map to Video Plane (3.2 x 1.8)
        // Note: Video Plane is at z = -5
        // Width 3.2, Height 1.8
        const x = (cx - 0.5) * 3.2; 
        const y = -(cy - 0.5) * 1.8 + 1.6;
        const z = -4.8; // Slightly in front of video (-5)

        const vLight = new VirtualLight({ x: cx, y: cy }, l.label || "Light " + deviceIdx);
        vLight.position.set(x, y, z);
        
        if (deviceIdx < realDevices.length) {
            vLight.realDevice = realDevices[deviceIdx];
        }

        xb.add(vLight);
        virtualLights.push(vLight);
        deviceIdx++;
    }
 
}


function createPassthrough() {
    if (!camera.videoElement) return;
    const videoTex = new THREE.VideoTexture(camera.videoElement);
    videoTex.colorSpace = THREE.SRGBColorSpace;
    
    // 16:9 Aspect Ratio
    const geometry = new THREE.PlaneGeometry(3.2, 1.8);
    const material = new THREE.MeshBasicMaterial({ 
        map: videoTex, 
        side: THREE.DoubleSide 
    });
    
    videoPlane = new THREE.Mesh(geometry, material);
    videoPlane.position.set(0, 1.6, -5); // Push video WAY back (-5m)
    xb.add(videoPlane);
}

// createStatusText - REMOVED (Replaced by HUDManager)

// createStatusText - REMOVED (Replaced by HUDManager)

// Interaction System for Gestures
// We register a global system to check hands against our virtual lights
class GestureSystem {
    update(dt) {
        // Access Hands
        const hands = xb.get().hands?.hands || []; // Check XRBlocks API for Hand access
        
        for (const hand of hands) {
            if (!hand || !hand.joints['index-finger-tip'] || !hand.joints['thumb-tip']) continue;
            
            const indexTip = hand.joints['index-finger-tip'].position;
            const thumbTip = hand.joints['thumb-tip'].position;
            
            // 1. Pinch Detection
            const pinchDist = indexTip.distanceTo(thumbTip);
            const isPinching = pinchDist < 0.02; // 2cm

            // Check against lights
            for (const vl of virtualLights) {
                // Distance from Hand Query Center (e.g. midpoint of pinch) to Light Object
                const pinchCenter = new THREE.Vector3().addVectors(indexTip, thumbTip).multiplyScalar(0.5);
                
                // Get world position of light mesh
                const lightPos = new THREE.Vector3();
                vl.mesh.getWorldPosition(lightPos);
                
                const distToLight = pinchCenter.distanceTo(lightPos);
                
                if (distToLight < 0.2) { // 20cm interaction radius
                    if (isPinching && !vl.lastPinch) {
                        // Pinch Start -> Toggle
                        vl.toggle();
                    }
                    
                    // 2. Rotation (Brightness)
                    if (isPinching) {
                        // Use Hand Rotation (Wrist Roll)
                        // If palm is facing Up vs Down? Or Twist?
                        // "Rotating thumbs up / thumbs down"
                        // Heuristic: Check angle of Thumb-Index vector relative to Horizon?
                        // Or just hand.rotation.z
                        
                        // Simple: Twist wrist.
                        // We need previous rotation to calculate delta.
                        // Let's just use absolute orientation for "Thumbs Up" (Bright) vs "Thumbs Down" (Dim)?
                        // Or continuous roll.
                        
                        // Let's try: Wrist roll.
                        // Assuming hand.quaternion is valid.
                    }
                }
                vl.lastPinch = isPinching;
            }
        }
    }
}

// Register System
// xb.registerSystem(new GestureSystem()); // If XRBlocks has system registry
// Or just hook into a global loop or behavior.
// For simplicity, let's attach this logic to the VirtualLight behavior or a Global Manager Behavior.
class GlobalManager extends xb.Script {
    onStart() {
        this.gestureSystem = new GestureSystem();
    }
    
    onUpdate(dt) {
        this.gestureSystem.update(dt);
    }
}
xb.add(new GlobalManager());


// Start UI
document.addEventListener('DOMContentLoaded', () => {
    setupUI();
});
