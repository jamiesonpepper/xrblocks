/**
 * main.js
 * Entry point for XRHome.
 */

// XR Interaction Logic
// XR Interaction Logic
const raycaster = new THREE.Raycaster();
const tempMatrix = new THREE.Matrix4();

// Drag State
let dragController = null;
let dragOffset = new THREE.Vector3();
let dragQuaternion = new THREE.Quaternion();

class HUDInteraction extends xb.Script {
    onUpdate() {
        if (dragController && hud.panel) {
            // Update HUD position ensuring it stays attached to controller relative transform
            // Simple: Make it follow controller position + offset?
            // Better: Apply the relative transform captured at start.
            
            // For now, simpler "move with controller"
            // hud.panel.position.copy(dragController.position).add(dragOffset); // Naive
            
            // Allow rotation dragging too?
            // hud.panel.quaternion.copy(dragController.quaternion).multiply(dragQuaternion);
            
            // Let's use `attach` logic implicitly by just parenting?
            // No, re-parenting in XR can be jumpy.
            
            // Best: Calculate new world matrix based on controller world matrix * inverse controller start * panel start
            // Too complex for quick fix.
            
            // Simple "stick to hand" logic:
            // Get controller world pos/rot
            const cPos = new THREE.Vector3();
            const cQuat = new THREE.Quaternion();
            dragController.getWorldPosition(cPos);
            dragController.getWorldQuaternion(cQuat);
            
            // Apply local offset stored in dragOffset (rotated)
            const v = dragOffset.clone().applyQuaternion(cQuat);
            hud.panel.position.copy(cPos).add(v);
            
            // Lock rotation to face user or keep relative? Keep relative to controller is naturally easiest for "grabbing"
            hud.panel.quaternion.copy(cQuat).multiply(dragQuaternion);
        }
    }
}

function onXRSelectStart(event) {
    const controller = event.target;
    
    // 1. Raycast HUD
    if (hud.panel) {
        tempMatrix.identity().extractRotation(controller.matrixWorld);
        raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
        
        const intersects = raycaster.intersectObject(hud.panel, true); // Recursive for buttons
        
        if (intersects.length > 0) {
            const hit = intersects[0];
            
            // Check if Border Hit
            // Convert to Local Point on Panel
            const localPoint = hud.panel.worldToLocal(hit.point.clone());
            
            // Panel Size (0.6 x 0.8)
            const w = 0.6;
            const h = 0.8;
            const border = 0.04; // Tolerance for border grab
            
            if (Math.abs(localPoint.x) > w/2 - border || Math.abs(localPoint.y) > h/2 - border) {
                // START DRAG
                dragController = controller;
                
                // Calculate Offset: Panel Pos relative to Controller
                const cPos = new THREE.Vector3();
                const cQuat = new THREE.Quaternion();
                controller.getWorldPosition(cPos);
                controller.getWorldQuaternion(cQuat);
                
                // offset = (panelPos - cPos) applying inverse controller rotation
                dragOffset.copy(hud.panel.position).sub(cPos).applyQuaternion(cQuat.clone().invert());
                
                // rotation offset
                dragQuaternion.copy(cQuat.clone().invert()).multiply(hud.panel.quaternion);
                
                hud.speak("Moving HUD");
                return; // Consume event
            }
        }
    }
}

function onXRSelectEnd(event) {
    if (dragController === event.target) {
        dragController = null;
    }
}

function onXRSelect(event) {
    // This triggers on Controller "Select" (Click) - i.e. Button Press
    const controller = event.target;
    
    // If we were dragging, ignore the click
    if (dragController === controller) return;

    // 2. Check Virtual Lights (Legacy Logic preserved)
    tempMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    // Target the hitMesh (invisible plane) for easier clicking
    const meshes = virtualLights.map(vl => vl.hitMesh).filter(m => m);
    const intersects = raycaster.intersectObjects(meshes);
    
    if (intersects.length > 0) {
        const hit = intersects[0];
        // Find VL that owns this hitMesh
        const vl = virtualLights.find(v => v.hitMesh === hit.object);
        
        if (vl) {
            console.log("XR Pinch on Light:", vl.labelText);
            vl.toggle();
            // hud.speak(vl.isOn ? "On" : "Off"); // moved to toggle()
        }
    }
    
    // Note: xb.SpatialPanel buttons handle their own clicks via xb's system usually.
    // If not, we might need to manually trigger them here.
    // We'll trust xb first.
}

import * as xb from 'xrblocks';
import { AuthManager } from './auth.js';
import { CameraManager } from './webrtc.js';
import { VisionManager } from './vision.js';
import { matterClient } from './matter-client.js';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { HUDManager } from './hud.js';
import { DeviceMenu } from './menu.js';

// Globals
const auth = new AuthManager();
const camera = new CameraManager('webrtc-video');
const vision = new VisionManager();
let smartHome = null;

// XR State
let realDevices = []; 
let virtualLights = []; 
let lastScanTime = 0;
const SCAN_INTERVAL = 30000; 
const hud = new HUDManager();
// Wire up HUD Scan Event
hud.onScanToggle = () => toggleScan();

const menu = new DeviceMenu();
let videoPlane = null;
let selectedLight = null; 
let isScanning = false;
let isConfiguring = false; 
let configIndex = 0;

// Setup Configuration UI
function setupUI() {
    const overlay = document.getElementById('config-overlay');
    const startBtn = document.getElementById('start-btn');
    const geminiInput = document.getElementById('gemini-key');
    const matterInput = document.getElementById('matter-code');

    if (auth.config.geminiKey) geminiInput.value = auth.config.geminiKey;
    if (auth.config.matterCode) matterInput.value = auth.config.matterCode;

    // Auto-start if configured
    if (auth.hasConfig()) {
         overlay.style.display = 'none';
         initApp();
         return;
    }

    startBtn.addEventListener('click', () => {
        const config = {
            geminiKey: geminiInput.value,
            matterCode: matterInput.value
        };
        auth.saveConfig(config);
        
        overlay.style.display = 'none';
        initApp();
        
        // Setup XR Interaction
        setTimeout(() => {
            if (xb.renderer && xb.renderer.xr) {
                const controller0 = xb.renderer.xr.getController(0);
                const controller1 = xb.renderer.xr.getController(1);
                
                // Add Listeners
                controller0.addEventListener('select', onXRSelect);
                controller1.addEventListener('select', onXRSelect);
                
                controller0.addEventListener('selectstart', onXRSelectStart);
                controller1.addEventListener('selectstart', onXRSelectStart);
                
                controller0.addEventListener('selectend', onXRSelectEnd);
                controller1.addEventListener('selectend', onXRSelectEnd);
                
                console.log("XR Interaction Listeners Attached");
                
                // Add Interaction Script for Dragging
                xb.add(new HUDInteraction());
            }
        }, 1000);
    });
}

// --- 2D Virtual Light (Desktop) ---
class VirtualLight2D {
    constructor(geminiData, labelText) {
        this.geminiData = geminiData;
        this.labelText = labelText; // Display Name
        this.label = labelText;     // Alias for pairing logic
        
        // Store Normalized Coordinates for HUD Drawing
        this.xmin = geminiData.xmin;
        this.xmax = geminiData.xmax;
        this.ymin = geminiData.ymin;
        this.ymax = geminiData.ymax;
        
        this.cx = (this.xmin + this.xmax) / 2;
        this.cy = (this.ymin + this.ymax) / 2;
        
        this.isOn = false;
        this.brightness = 100;
        this.realDevice = null;
        this.linkedNodeId = null; 
    }

    checkClick(normX, normY) {
        // Simple 2D Box Hit Test
        return (normX >= this.xmin && normX <= this.xmax && 
                normY >= this.ymin && normY <= this.ymax);
    }

    toggle() {
        this.isOn = !this.isOn;
        console.log(`[2D Light] Toggle ${this.labelText} -> ${this.isOn}`);
        
        // Send to real device
        if (this.realDevice && smartHome) {
            hud.speak(this.isOn ? "Turning On" : "Turning Off");
            smartHome.toggleLight(this.realDevice.id, this.isOn);
        }
        
        // Force HUD Redraw
        if (hud && hud.drawLights) hud.drawLights(virtualLights);
    }
    
    setBrightness(val) {
        this.brightness = val;
        if (this.realDevice && smartHome) {
            smartHome.setBrightness(this.realDevice.name, val);
        }
    }
    
    updateVisuals() {
        // No-op for 2D object, HUD handles drawing based on state
    }
}

// --- 3D Virtual Light (AR/XR) ---
class VirtualLight3D extends xb.Script {
  constructor(geminiData, labelText) {
      super();
      this.geminiData = geminiData;
      this.labelText = labelText;
      this.label = labelText;
      this.isOn = false;
      this.brightness = 100;
      this.realDevice = null;
      this.linkedNodeId = null; 

      // 1. Calculate Dimensions (Video Plane: 3.2 x 1.8)
      const vW = 3.2;
      const vH = 1.8;
      
      const width = (geminiData.xmax - geminiData.xmin) * vW;
      const height = (geminiData.ymax - geminiData.ymin) * vH;
      
      // 2. Create Bounding Box (LineSegments)
      const geometry = new THREE.BoxGeometry(width, height, 0.05); 
      const edges = new THREE.EdgesGeometry(geometry);
      const material = new THREE.LineBasicMaterial({ 
          color: 0xFFFF00, // Default Yellow
          linewidth: 2 
      });
      
      this.mesh = new THREE.LineSegments(edges, material);
      
      // Hit Mesh
      const hitGeo = new THREE.PlaneGeometry(width, height);
      const hitMat = new THREE.MeshBasicMaterial({ visible: false });
      this.hitMesh = new THREE.Mesh(hitGeo, hitMat);
      this.mesh.add(this.hitMesh); 
      
      this.add(this.mesh);
      
      // 3. Label + Icon
      this.labelSprite = this.createLabelSprite(labelText, "⚙️", "#FFFF00");
      this.labelSprite.position.set(0, -height/2 - 0.15, 0); 
      this.mesh.add(this.labelSprite);
      
      // Restore needed properties for compatibility/logic
      this.xmin = geminiData.xmin;
      this.xmax = geminiData.xmax;
      this.ymin = geminiData.ymin;
      this.ymax = geminiData.ymax;
  }
  
  createLabelSprite(text, icon, color) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = 512;
      canvas.height = 128;
      
      ctx.font = 'bold 48px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      ctx.shadowColor = 'black';
      ctx.shadowBlur = 4;
      ctx.fillStyle = color;
      
      // "Name  [Icon]"
      const fullText = `${text}  ${icon}`;
      ctx.fillText(fullText, 256, 64);
      
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({ map: texture });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(0.8, 0.2, 1.0);
      return sprite;
  }
  
  updateVisuals() {
      if (!this.mesh) return;
      
      const isPaired = !!(this.realDevice || this.linkedNodeId);
      const isOn = this.isOn;
      
      let colorHex = 0xFFFF00; // Yellow (Unpaired)
      let icon = "⚙️"; // Gear
      
      if (isPaired) {
          if (isOn) {
              colorHex = 0xFFFFFF; // White (On)
              icon = "✕"; 
          } else {
              colorHex = 0x00FF00; // Green (Off)
              icon = "✕";
          }
      }
      
      if (this.mesh.material) {
          this.mesh.material.color.setHex(colorHex);
      }
      
      const oldSprite = this.labelSprite;
      this.labelSprite = this.createLabelSprite(this.labelText, icon, isPaired ? (isOn ? '#FFFFFF' : '#00FF00') : '#FFFF00');
      this.labelSprite.position.copy(oldSprite.position);
      
      this.mesh.remove(oldSprite);
      this.mesh.add(this.labelSprite);
      
      if (oldSprite.material.map) oldSprite.material.map.dispose();
  }

  toggle() {
      this.isOn = !this.isOn;
      this.updateVisuals();
      
      if (this.realDevice && smartHome) {
          console.log(`[Toggle] 3D Light ${this.labelText} -> ${this.isOn}`);
          smartHome.toggleLight(this.realDevice.id, this.isOn).then(() => {
              hud.speak(this.isOn ? "Turning On" : "Turning Off");
          });
      } 
  }

  setBrightness(val) {
      this.brightness = Math.max(0, Math.min(100, val));
      if (this.realDevice && smartHome) {
          smartHome.setBrightness(this.realDevice.name, this.brightness);
      }
  }
  
  // Legacy checkClick for 3D? Not used, handled by Raycaster
  checkClick() { return false; }
}


// --- Main App Logic ---

async function initApp() {
    console.log("Initializing XRHome...");
    
    // smartHome is now the matterClient singleton
    smartHome = matterClient;
    
    // 1. Fetch Real Devices
    await refreshRealDevices();

    // 2. Start Camera
    await camera.startCamera();

    // Check for AR Support
    let isARSupported = false;
    if (navigator.xr) {
        try {
            isARSupported = await navigator.xr.isSessionSupported('immersive-ar');
        } catch(e) {
            console.warn("XR Check failed", e);
        }
    }
    console.log("AR Supported:", isARSupported);

    // 3. Init XRBlocks
    await RAPIER.init(); // Fix: No arguments
    const o = new xb.Options();
    if (isARSupported) {
        o.enableUI(); // Only show "Enter AR" if supported
    } else {
        // Desktop Mode: Create a transparent canvas manually
        if (!o.canvas) {
            o.canvas = document.createElement('canvas');
            o.canvas.id = 'xr-canvas';
            // Force transparency via context attributes - this is critical for WebGLRenderer
            const gl = o.canvas.getContext('webgl2', { alpha: true, antialias: true }) 
                    || o.canvas.getContext('webgl', { alpha: true, antialias: true });
        }
        
        // Ensure CSS transparency
        o.canvas.style.background = 'transparent';
    }
    
    o.physics.RAPIER = RAPIER;
    o.physics.useEventQueue = true;
    o.physics.worldStep = true;
    o.hands.enabled = true; // Use Hands
    o.simulator.defaultMode = xb.SimulatorMode.POSE; // Or generic

    xb.init(o);

    // REMOVED: Desktop Camera Eye-Level workaround (caused crash with xb.get)
    // 2D HUD does not require this.

    // 4. Create Passthrough Plane (HUD) - ONLY for AR (or if we want it in VR)
    if (isARSupported) {
         createPassthrough();
    } else {
        // Ensure scene is transparent so HTML video shows through
        // Try safe access to scene
        try {
             if (xb.scene) {
                 xb.scene.background = null;
             } else if (typeof xb.get === 'function') {
                 const app = xb.get();
                 if (app && app.scene) app.scene.background = null;
             }
        } catch(e) {
            console.warn("Could not set scene background to null", e);
        }
    }
    
    // 6. Init HUD
    // 6. Init HUD
    if (!isARSupported) {
        // Desktop: 2D Overlay
        // Ensure HUD handles string mode correctly
        console.log("HUD: Initializing 2D Desktop Overlay...");
        hud.init(document.body, '2D');
        console.log("HUD: 2D Overlay Attached to Body");
        
        // 6b. Init Menu (2D)
        menu.init(document.body, '2D');
        
    } else {
        // XR: 3D Plane
        // Wait for engine/scene
        setTimeout(() => {
             // Access App Instance
             let app = null;
             // Safe check for xb.get
             try {
                if (typeof xb.get === 'function') {
                    app = xb.get();
                }
             } catch(e) {}
             
             // Fallback to scene export if get() fails or app is missing
             const parent = app?.camera || xb.scene; 
             
             if (parent) {
                hud.init(parent, '3D');
                console.log("HUD: 3D Plane Attached to Scene/Camera");
                
                // 6b. Init Menu (3D)
                menu.init(xb.scene || parent); // Attach to scene usually
             } else {
                console.warn("Could not find Camera or Scene for 3D HUD");
             }
        }, 500);
    }
    
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
        
        // Speak important updates
        if (msg.includes("Found")) {
            hud.speak(msg);
        } else if (msg.includes("Error")) {
            hud.speak("Vision Error");
        }
    };

    vision.onLightsFound = (lights) => {
        // Update HUD Bounding Boxes (Desktop)
        hud.drawLights(lights);
        
        hud.speak(`Found ${lights.length} lights.`);
        spawnVirtualLights(lights);
    };

    hud.log("Vision System Started");
    hud.speak("Vision System Ready. Say 'Scan' or click button.");
    hud.log("Ready. Click Scan to Start.");
    
    // Auto-Loop (Active only when isScanning is true)
    setInterval(async () => {
        if (!isScanning) return;
        
        const canvas = document.getElementById('process-canvas');
        if (!camera.videoElement || camera.videoElement.readyState < 2) return;
        
        const blob = await camera.captureFrame(canvas);
        if (blob) {
            hud.log("Scanning...", '#888888');
            vision.analyzeFrame(blob);
        }
    }, 5000); // 5s Interval

    // Manual Trigger Setup
    const scanBtn = document.getElementById('scan-now-btn');
    if (scanBtn) {
        scanBtn.style.display = 'block';
        scanBtn.innerText = "Start Scanning ▶️";
        scanBtn.addEventListener('click', () => {
             toggleScan();
        });
    }

    const searchBtn = document.getElementById('search-btn');
    if (searchBtn) {
        searchBtn.style.display = 'none'; // Integrated into Stop flow
    }
    
    // Keyboard Input for Search
    // Keyboard Input for Search
    window.addEventListener('keydown', (e) => {
        if (menu.visible) {
            // Trap Enter
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                menu.selectTopResult();
                return;
            }
            
            // Ignore system keys?
            if (e.key.length === 1 || e.key === 'Backspace') {
                menu.type(e.key);
            }
        }
    });

    // Voice Command Setup
    setupVoiceCommand();
}

function toggleScan() {
    isScanning = !isScanning;
    
    // Update HUD Button State
    if (hud && hud.setScanState) {
        hud.setScanState(isScanning);
    }
    
    if (isScanning) {
        // START
        hud.speak("Scanning started. Please pan around.");
        hud.log("Scanning Active...", '#00FF00');
    } else {
        // STOP (PAUSE)
        hud.speak("Scanning paused. Configure lights.");
        hud.log("Scanning Paused", '#FFFF00');
        
        // Ensure we don't clear lights, so they persist for picking
    }
}

async function startAssignmentFlow() {
    const btn = document.getElementById('scan-now-btn');
    
    // Lock UI
    isConfiguring = true;
    if (btn) {
        btn.disabled = true;
        btn.innerText = "Configuring... (Locked)";
        btn.style.background = "#999";
        btn.style.cursor = "not-allowed";
    }

    // Refresh Devices to ensure list is up to date
    hud.speak("Refreshing device list...");
    await refreshRealDevices();

    configIndex = 0;
    if (virtualLights.length === 0) {
        // hud.speak("No lights found to configure.");
        // endAssignmentFlow();
        // return;
        // User might want to pair a device even if we haven't "found" one visually? 
        // No, the flow is "Scan -> Detect -> Configure".
        // Use "No lights found" logic as is.
        hud.speak("No lights found to configure.");
        endAssignmentFlow();
        return;
    }
    configureNextLight();
}

async function refreshRealDevices() {
    try {
        console.log("Fetching Matter Devices...");
        
        // 1. Auto-Commission if code is present and we have no devices?
        // Or just Try to Commission on every start if code exists?
        // Commissioning ignores if already commissioned (usually).
        if (auth.config.matterCode) {
            const codes = auth.config.matterCode.split(',').map(c => c.trim()).filter(c => c.length > 0);
            
            if (codes.length > 0) {
                hud.log(`Processing ${codes.length} Pairing Codes...`, '#FFFF00');
                
                for (const code of codes) {
                    try {
                        // Skip if we think it's already done? Hard to know without state.
                        // Ideally backend handles idempotency or we just try.
                        hud.log(`Pairing code ending in ...${code.slice(-4)}`, '#FFFF00');
                        const res = await smartHome.commissionDevice(code);
                        if (res.success) {
                             hud.speak("Device Paired!");
                             hud.log(`Paired Node: ${res.nodeId}`, '#00FF00');
                        } else {
                             console.warn("Pairing failed for " + code, res);
                             // Don't spam HUD failure unless critical
                        }
                    } catch(err) {
                        console.error("Pairing Loop Error", err);
                    }
                }
            }
        }
        
        const devices = await smartHome.listDevices();
        console.log("Raw Devices Returned:", devices);
        
        realDevices = devices.filter(d => 
            d.type === 'sdm.devices.types.LIGHT' || 
            d.type === 'LIGHT' || // Matter Client default
            (d.traits && d.traits['sdm.devices.traits.OnOff'])
        );
        
        console.log(`Filtered Devices: ${realDevices.length} (from ${devices.length} raw)`);

        if (realDevices.length === 0) {
            console.log("No existing devices found. User can pair later.");
        } else {
            console.log(`Found ${realDevices.length} Real Devices.`);
        }
        
        // Update Links whenever devices change
        linkLightsToDevices();
        
    } catch (e) {
        console.error("Failed to list real devices", e);
        hud.speak("Failed to fetch devices. Check console.");
    }
}

function endAssignmentFlow() {
    isConfiguring = false;
    const btn = document.getElementById('scan-now-btn');
    if (btn) {
        btn.disabled = false;
        btn.innerText = "Start Scanning ▶️";
        btn.style.background = "#4285f4"; // Blue
        btn.style.cursor = "pointer";
    }
}

function configureNextLight() {
    if (configIndex >= virtualLights.length) {
        hud.speak("All lights configured.");
        // Clear Highlights?
        endAssignmentFlow();
        return;
    }
    
    // In 2D Desktop mode, virtualLights might be just data objects, not meshes.
    // We need to handle that.
    const vl = virtualLights[configIndex];
    selectedLight = vl;
    
    // Highlight (3D Overlay or 2D Box Color change?)
    // For 2D, we can update drawing via HUD?
    // Let's modify the 'vl' object to have a 'highlight' property which HUD reads.
    // If vl extends xb.Script (3D), it has a mesh.
    
    if (vl.mesh) {
        vl.mesh.material.color.setHex(0x00FFFF); // Cyan Highlight
    } else {
        // Desktop 2D fallback: We can't easily change color of drawn box unless we update HUD state.
        // hud.highlightLight(configIndex)?
        // For now, let's just log.
    }
    
    hud.speak(`Configuring Light ${configIndex + 1}. Select a device from the list.`);
    
    // Inject "Pair New Device" Option
    const menuItems = [
        { 
            type: 'PAIR_ACTION', 
            traits: { "sdm.devices.traits.Info": { customName: "➕ Pair New Matter Device" } } 
        },
        ...realDevices
    ];

    // Open Menu
    // We reuse openSearchMenu logic but specific to this flow
    menu.show(menuItems, async (device) => {
        
        // Handle Pairing Action
        if (device.type === 'PAIR_ACTION') {
            const code = prompt("Enter 11 or 21-digit Matter Pairing Code:");
            if (code) {
                hud.speak("Pairing device...");
                hud.log("Pairing...", '#FFFF00');
                const res = await smartHome.commissionDevice(code);
                if (res.success) {
                    hud.speak("Success! Pairing Complete.");
                    hud.log("Paired!", '#00FF00');
                    // Refresh and Re-Show Menu
                    await refreshRealDevices();
                    configureNextLight(); // Recursively call to re-show menu
                } else {
                    hud.speak("Pairing Failed. Check console.");
                    hud.log("Error: " + (res.error?.message || "Unknown"), '#FF0000');
                    // Re-show menu?
                    setTimeout(configureNextLight, 2000);
                }
            } else {
                // Cancelled
                configureNextLight();
            }
            return;
        }

        // Normal Select
        vl.realDevice = device;
        if (vl.mesh) vl.mesh.material.color.setHex(0x00FF00); // Green (Done)
        hud.speak(`Linked Light to ${device.traits?.["sdm.devices.traits.Info"]?.customName || "Device"}`);
        
        // Next
        configIndex++;
        // Small delay
        setTimeout(configureNextLight, 1000);
        
    }, (text) => hud.speak(text));
}

// Deprecated: triggerScan, openSearchMenu (Replaced by flow)

function setupVoiceCommand() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.warn("Speech Recognition not supported");
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true; // Keep listening
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
        const last = event.results.length - 1;
        const text = event.results[last][0].transcript.trim().toLowerCase();
        console.log("Speech Heard:", text);
        
        if (text.includes("scan") || text.includes("computer")) {
            if (!isScanning && !isConfiguring) toggleScan();
        }
        else if (text.includes("stop")) {
             if (isScanning) toggleScan();
        }
        else if (menu.visible) {
            // Pass content to menu search
            // Strip "search for"?
            let query = text.replace("search for", "").replace("find", "").trim();
            menu.setQuery(query);
        }
    };

    recognition.onerror = (e) => {
        console.error("Speech Recognition Error", e.error);
    };
    
    // Auto-restart if it stops (simple keep-alive)
    recognition.onend = () => {
         // recognition.start(); 
         // Optional: Don't force restart if user stopped it? 
         // For a demo, let's try to keep it alive or just let them click button if it dies.
         console.log("Speech Loop Ended");
    };

    try {
        recognition.start();
        console.log("Voice Command Listening...");
    } catch(e) {
        console.error("Failed to start speech", e);
    }
}

function spawnVirtualLights(lights) {
    console.log("Rebuilding Lights:", lights);
    
    // Check Mode
    const is3D = (hud.mode === '3D');
    
    // 1. Separate tracked vs untracked
    const keptLights = [];
    const newCandidates = [];
    
    // Keep lights that are already linked (Paired)
    for (const vl of virtualLights) {
        if (vl.linkedNodeId) {
            keptLights.push(vl);
        } else {
            // Remove unlinked ones from scene to be replaced
            // Only if it's a 3D light with a mesh
            if (vl.mesh) {
                // Remove from scene/parent
                if (vl.parent) vl.parent.remove(vl); // If added via xb.add
                else xb.scene.remove(vl.mesh);       // Direct scene remove fallback
                
                if (vl.mesh.geometry) vl.mesh.geometry.dispose();
                if (vl.mesh.material) vl.mesh.material.dispose();
            }
        }
    }
    
    // 2. Process New Detections
    for (const l of lights) {
        const exists = keptLights.find(kl => kl.labelText === l.label);
        if (!exists) {
             newCandidates.push(l);
        }
    }

    // 3. Rebuild List
    virtualLights = [...keptLights];

    // 4. Create Objects for New Candidates
    let deviceIdx = virtualLights.length + 1;
    
    for (const l of newCandidates) {
        const label = l.label || "Light " + (deviceIdx++);
        
        if (is3D) {
            // --- 3D MODE ---
            const vLight = new VirtualLight3D(l, label);
            
            // Unproject Bounding Box Center
            const cx = (l.xmin + l.xmax) / 2;
            const cy = (l.ymin + l.ymax) / 2;
    
            // Map to Video Plane (3.2 x 1.8)
            const x = (cx - 0.5) * 3.2; 
            const y = -(cy - 0.5) * 1.8 + 1.6;
            const z = -4.8; 
            
            if (vLight.mesh) {
                 vLight.mesh.position.set(x, y, z);
                 // Default New/Unpaired = Yellow
                 vLight.mesh.material.color.setHex(0xFFFF00); 
            }
            
            virtualLights.push(vLight);
            xb.add(vLight.mesh); 
        } else {
            // --- 2D MODE ---
            const vLight = new VirtualLight2D(l, label);
            virtualLights.push(vLight);
        }
    }
    
    // 5. Update Colors / State for Kept Lights
    for (const vl of keptLights) {
        if (vl.updateVisuals) vl.updateVisuals();
    }
    
    // Re-Link
    linkLightsToDevices();
 } 



 function linkLightsToDevices() {
     console.log("[Link] Updating Links between Virtual Lights and Real Devices...");
     if (virtualLights.length === 0) return;
     
     // 1. Clear existing links first (to allow re-assignment)
     // Actually, we want to keep them if valid.
     
     for (const vl of virtualLights) {
         let matchedDevice = null;

         // A. Check Explicit Link (nodeId)
         if (vl.linkedNodeId) {
             matchedDevice = realDevices.find(d => d.id === vl.linkedNodeId || d.nodeId === vl.linkedNodeId);
         }
         
         // B. Check Label Match (Name-based)
         if (!matchedDevice && vl.labelText) {
             matchedDevice = realDevices.find(d => d.name === vl.labelText || (d.traits && d.traits["sdm.devices.traits.Info"]?.customName === vl.labelText));
         }

         // C. Fallback: Index-based (Legacy/Auto) - only if no explicit link
         // This is risky if list order changes. 
         // Let's Disable Index Matching for now to allow explicit assignment only?
         // Or map unassigned lights to unassigned devices?
         /*
         if (!matchedDevice) {
             // Find first unassigned device?
         }
         */

         if (matchedDevice) {
              if (vl.realDevice !== matchedDevice) {
                  vl.realDevice = matchedDevice;
                  // If we didn't have ID, save it now
                  vl.linkedNodeId = matchedDevice.id; 
                  
                  const devName = matchedDevice.traits?.["sdm.devices.traits.Info"]?.customName || matchedDevice.name || "Device";
                  console.log(`[Link] Linked '${vl.labelText}' <-> Device: ${devName} (ID: ${matchedDevice.id})`);
                  hud.speak(`Linked to ${devName}`);
                  if (vl.mesh) vl.mesh.material.color.setHex(0x00FF00); // Green (Linked)
              }
         } else {
              if (vl.realDevice) {
                  console.log(`[Link] Unlinked '${vl.labelText}'`);
                  vl.realDevice = null;
                  if (vl.mesh) vl.mesh.material.color.setHex(0xFFFF00); // Yellow (Unlinked)
              }
         }

         // Poll State if linked (Throttle during scan?)
         // User requested: "When scanning... unnecessary calls to /light/state... should be removed"
         if (vl.realDevice && smartHome && !isScanning) {
             smartHome.getLightState(vl.realDevice.id).then(isOn => {
                 if (isOn !== null && vl.isOn !== isOn) {
                     // ... (State Sync Logic)
                     console.log(`[Poll] Syncing State for ${vl.labelText}: ${isOn ? 'ON' : 'OFF'}`);
                     vl.isOn = isOn;
                     if (vl.mesh) {
                         const color = vl.isOn ? 0xFFFFFF : 0x00FF00;
                         vl.mesh.material.color.setHex(color);
                         vl.mesh.material.emissive.setHex(color);
                         vl.mesh.material.emissiveIntensity = vl.isOn ? 1.0 : 0.2;
                     }
                     // Force HUD Refresh (2D) to reflect color change immediately
                     if (hud && hud.drawLights) hud.drawLights(virtualLights);
                 }
             });
         }
     }
     
     // Update HUD
     if(hud && hud.drawLights) hud.drawLights(virtualLights);
 }


function createPassthrough() {
    // In WebXR AR, the browser handles passthrough naturally.
    // Creating a plane with the webcam feed (videoTex) often shows the "User Facing" camera 
    // or an Avatar in some browsers/devices (like Quest), which overlays the real world.
    // User requested "Virtual camera overlay... isn't needed".
    // So we DISABLING this manual plane creation.
    
    console.log("Skipping manual VideoPlane creation for AR (using native passthrough)");
    return;

    /* REPLACED: 
    if (!camera.videoElement) return;
    const videoTex = new THREE.VideoTexture(camera.videoElement);
    ...
    xb.add(videoPlane);
    */
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


// --- Interaction (Mouse/Touch Raycasting) ---
// raycaster defined globally at top
const mouse = new THREE.Vector2();

window.addEventListener('pointerdown', (event) => {
    if (menu.visible) return;

    // Aspect Ratio Correction for object-fit: cover
    const video = camera.videoElement;
    if (!video || !video.videoWidth) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const sw = window.innerWidth;
    const sh = window.innerHeight;
    
    // Scale: "Cover" means max of width/height ratios
    const scale = Math.max(sw / vw, sh / vh);
    const displayedW = vw * scale;
    const displayedH = vh * scale;
    
    // Offsets to center the scaled video
    const offsetX = (sw - displayedW) / 2;
    const offsetY = (sh - displayedH) / 2;
    
    // Convert Screen Click -> Image Space
    const clickX = event.clientX - offsetX;
    const clickY = event.clientY - offsetY;
    
    const normX = clickX / displayedW;
    const normY = clickY / displayedH;

    // Check HUD UI First (Screen Coordinates)
    const hudAction = hud.checkClick(event.clientX, event.clientY);
    if (hudAction) {
        if (hudAction.type === 'SCAN') {
            console.log("HUD Scan Clicked");
            toggleScan();
        } else if (hudAction.type === 'CONFIG') {
            const l = hudAction.light;
            const vl = virtualLights[hudAction.index];
            console.log("HUD Config Clicked:", l.label, vl);
            
            if (vl.realDevice) {
                // UNPAIR FLOW
                if (confirm(`Unpair from ${vl.realDevice.name || "Device"}?`)) {
                    hud.speak("Unpairing device...");
                    hud.log(`Unpairing ${vl.realDevice.id}...`, '#FFFF00');
                    
                    smartHome.unpairDevice(vl.realDevice.id).then(success => {
                        if (success) {
                            hud.speak("Device Unpaired.");
                            hud.log("Unpaired & Removed.", '#00FF00');
                            hud.log("Unpaired & Removed.", '#00FF00');
                            
                            // Reset State fully
                            vl.realDevice = null;
                            vl.linkedNodeId = null; // Important: Clear explicit link
                            vl.isOn = false;        // Reset state so it doesn't think it's ON
                            
                            // Visuals: Back to Yellow (Unpaired)
                            if (vl.mesh) {
                                vl.mesh.material.color.setHex(0xFFFF00); 
                                vl.mesh.material.emissive.setHex(0xFFFF00);
                                vl.mesh.material.emissiveIntensity = 0.2; // Low glow
                            }
                            
                            // 2D HUD Refresh
                            if (hud && hud.drawLights) hud.drawLights(virtualLights);
                            
                            // Refresh logic to clear stale references
                            setTimeout(refreshRealDevices, 500);
                        } else {
                            hud.speak("Unpair Failed.");
                        }
                    });
                }
            } else {
                // PAIR FLOW
                const code = prompt("Enter 11 or 21-digit Matter Pairing Code:");
                if (code) {
                    hud.speak("Pairing device...");
                    hud.log("Pairing...", '#FFFF00');
                    
                    // Pass the Label from the Virtual Light (e.g. "Lamp") so server can use it
                    smartHome.commissionDevice(code, vl.label).then(res => {
                         if (res.success) {
                            hud.speak("Success! Logic Pairing Complete.");
                            hud.log("Paired!", '#00FF00');
                            
                            // EXPLICIT LINKING
                            // Store the NodeID on this specific Virtual Light
                            vl.linkedNodeId = res.nodeId;
                            console.log(`[Pair] Explicitly linked ${vl.labelText} to Node ${res.nodeId}`);
                            
                            // Refresh immediately to link
                            refreshRealDevices();
                        } else {
                            hud.speak("Pairing Failed. Check console.");
                            hud.log("Error: " + (res.error?.message || "Unknown"), '#FF0000');
                        }
                    });
                }
            }
        }
        return;
    }
    
    // Check Virtual Lights
    for (const vl of virtualLights) {
        if (vl.checkClick(normX, normY)) {
            console.log("Clicked Light:", vl.labelText);
            vl.toggle();
            hud.speak(vl.isOn ? "On" : "Off");
            
            if (vl.mesh) {
                // Flash Highlight
                vl.mesh.material.color.setHex(0xFFFFFF);
                setTimeout(() => {
                    vl.mesh.material.color.setHex(vl.isOn ? 0xFFFFFF : 0xFFFF00);
                }, 200);
            }
            return;
        }
    }
}); 



// Start UI
document.addEventListener('DOMContentLoaded', () => {
    setupUI();
});
