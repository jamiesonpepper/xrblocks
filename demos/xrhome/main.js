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

// Vision Buffers (Global for access by toggleScan)
let latestFrameBlob = null;
let latestCameraMatrix = null;

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
    
    // Define draggables: HUD and Keypad ONLY
    const draggables = [];
    if (hud.panel) draggables.push(hud.panel);
    if (keypad.visible && keypad.panel && keypad.panel.mesh) draggables.push(keypad.panel); 

    // STRICT: Do NOT add Virtual Lights to draggables list.
    // However, if Raycaster hits them via other means (global scene check?), we must ignore.
    // Pass 'draggables' to intersectObjects limits the check to ONLY these items.
    // So if Virtual Lights are not in this list, they CANNOT be dragged by this function.
    // This confirms onXRSelectStart is NOT moving them. 
    //
    // UNLESS: 'hud.panel' or 'keypad.panel' somehow includes the lights? (Unlikely)
    // OR: There is *another* drag handler.
    //
    // Let's assume onXRSelectStart is the culprit and maybe my logic for "draggables" included them before?
    // No, I was using 'hud.panel' explicitly.
    //
    // Wait! 'hud.panel' might contain them if they are parented to it?
    // VirtualLight3D is added to 'scene' or 'world'? 
    //
    // Let's verify VirtualLights are NOT children of HUD or Keypad.
    
    tempMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    // Intersect ONLY permitted draggables
    const intersects = raycaster.intersectObjects(draggables, true);

    if (intersects.length > 0) {
        const hit = intersects[0];
        
        // Find root draggable (Panel)
        let targetPanel = null;
        if (hud.panel && (hit.object === hud.panel || hud.panel.children.includes(hit.object))) targetPanel = hud.panel;
        else if (keypad.panel && (hit.object === keypad.panel || keypad.panel.children.includes(hit.object) || hit.object.parent === keypad.panel)) targetPanel = keypad.panel;
        
        // Check explicit lock
        if (targetPanel && (targetPanel.isDraggable === false || targetPanel.userData?.isDraggable === false)) return;

        if (targetPanel) {
             // Convert to Local Point on Panel
            const localPoint = targetPanel.worldToLocal(hit.point.clone());
            
            // Panel Size (0.6 x 0.8 usually, but dynamic)
            // Assuming standard size or check geometry?
            // HUD is 0.6x0.8. Keypad is 0.6x0.8.
            const w = 0.6; 
            const h = 0.8;
            const border = 0.04; 
            
            // Grab ANYWHERE on Keypad (header) or just border?
            // HUD logic was border-only. Keypad user wants "click/move functionality from virtual light panels" (which was whole panel?)
            // Let's allow border grab for consistency.
            if (Math.abs(localPoint.x) > w/2 - border || Math.abs(localPoint.y) > h/2 - border || targetPanel === keypad.panel) {
                // Allow grabbing Keypad anywhere if it's the target? Or just border?
                // User said "move functionality to virtual keypad". 
                // Let's assume border grab for now, but maybe widen it.
                
                dragController = controller;
                // Store parent of panel (Group) or Panel itself?
                // HUD moves `hud.panel`. Keypad moves `keypad.group` probably?
                // Keypad init: `this.group.add(this.panel)`. Moving `panel` inside group is weird. Move group!
                const objectToMove = (targetPanel === keypad.panel) ? keypad.group : targetPanel;
                
                dragController.userData.selected = objectToMove;
                
                const cPos = new THREE.Vector3();
                const cQuat = new THREE.Quaternion();
                controller.getWorldPosition(cPos);
                controller.getWorldQuaternion(cQuat);
                
                dragOffset.copy(objectToMove.position).sub(cPos).applyQuaternion(cQuat.clone().invert());
                dragQuaternion.copy(cQuat.clone().invert()).multiply(objectToMove.quaternion);
                
                hud.speak("Moving Panel");
                return;
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

    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    // 1. Check Keypad Interaction (High Priority)
    if (keypad.visible && keypad.mesh) {
        const keypadIntersects = raycaster.intersectObject(keypad.mesh);
        if (keypadIntersects.length > 0) {
            const hit = keypadIntersects[0];
            // UV to 0..1
            if (hit.uv) {
                // UV y is inverted in Three.js plane mapping relative to Canvas? 
                // texture.flipY usually defaults.
                // Our VirtualKeypad.handleClick expects UV where (0,0) is bottom-left? 
                // Let's pass raw UV and let handleClick handle it (it does 1-y).
                keypad.handleClick(hit.uv);
            }
            return; // Consume event
        }
    }

    // 2. Check Virtual Lights (Legacy Logic preserved)

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
import { VirtualKeypad } from './menu.js';

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

const keypad = new VirtualKeypad();
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
// --- 3D Virtual Light (AR/XR) ---
// --- 3D Virtual Light (AR/XR) ---
class VirtualLight3D extends THREE.Group {
  constructor(geminiData, labelText, width = 1.2, height = 0.4) {
      super();
      this.geminiData = geminiData; // Keep for xmin/xmax/ymin/ymax
      this.labelText = labelText || "Light";
      this.label = labelText; // Alias for pairing logic
      this.isOn = false;
      this.brightness = 100;
      this.realDevice = null;
      this.linkedNodeId = null; 

      // Removed 3D Model logic for simplicity (just using label box)
      // If we wanted to draw a 3D box, we could do it here.
      
      /* Legacy Box
      const geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
      const mat = new THREE.MeshStandardMaterial({ 
          color: 0x555555,
          emissive: 0x000000,
          roughness: 0.2
      });
      this.mesh = new THREE.Mesh(geo, mat);
      this.add(this.mesh);
      
      const edges = new THREE.EdgesGeometry(geo);
      const material = new THREE.LineBasicMaterial({ 
          color: 0xFFFF00, // Default Yellow
          linewidth: 2 
      });
      */
      
      // Hit Mesh (Invisible, for easier raycasting if needed)
      // Keep detection area for legacy interaction logic if needed
      // Hit Mesh (Invisible, for easier raycasting if needed)
      const hitGeo = new THREE.PlaneGeometry(width, height);
      const hitMat = new THREE.MeshBasicMaterial({ visible: false });
      this.hitMesh = new THREE.Mesh(hitGeo, hitMat);
      
      // CRITICAL: Lock the Hit Mesh too
      this.hitMesh.isDraggable = false;
      this.hitMesh.isRotatable = false;
      
      this.add(this.hitMesh);
      
      // 3. Label + Interface (Spatial Panel)
      this.panel = new xb.SpatialPanel({
          width: width, 
          height: height, 
          backgroundColor: '#00000033', // Black with 20% opacity using alpha hex
          draggable: false,             // Disables XRBlocks native dragging
      });
      
      this.panel.isInteractive = false;
      this.panel.mesh.isDraggable = false;
      this.panel.isDraggable = false;
      
      // Recursively disable dragging on EVERYTHING
      this.panel.traverse(c => {
          c.isDraggable = false;
          c.userData = c.userData || {};
          c.userData.isDraggable = false;
      });
      
      this.hitMesh.isDraggable = false;
      this.hitMesh.userData = { isDraggable: false };

      // Positioned below the box
      this.panel.position.set(0, -height/2 - 0.25, 0);
      this.add(this.panel);

      this.rebuildPanel();
      
      this.xmin = geminiData.xmin;
      this.xmax = geminiData.xmax;
      this.ymin = geminiData.ymin;
      this.ymax = geminiData.ymax;
  }
  
  rebuildPanel() {
      if (!this.panel) return;
      
      if (!this.mainGrid) {
           this.mainGrid = this.panel.addGrid();
      }
      this.mainGrid.clear(); 

      // Locked Interaction
      this.panel.isInteractive = true;
      this.panel.isDraggable = false;
      this.panel.isRotatable = false;
      this.panel.userData.isVirtualLight = true; // Flag for strict ignore
      
      // Removed custom borderMesh and manual opacity override. 
      // Opacity is handled correctly by xrblocks via the #00000033 hex in the constructor.
      
      // Ensure the newly rebuilt panel and its children are strictly not draggable, rotatable, or grabbable
      this.panel.traverse(c => {
          c.isDraggable = false;
          c.isRotatable = false;
          c.isGrabbable = false;
          c.userData = c.userData || {};
          c.userData.isDraggable = false;
          c.userData.isRotatable = false;
          c.userData.isGrabbable = false;
      });
      
      const isPaired = !!(this.realDevice || this.linkedNodeId);
      const isOn = this.isOn;
      
      const stateColor = this.stateColor !== undefined ? this.stateColor : '#FFFF00';
      
      // ROW 1: Label
      const rowLabel = this.mainGrid.addRow({ weight: 0.4 });
      rowLabel.addText({ 
          text: this.labelText, 
          fontSize: 0.08, 
          fontColor: stateColor, // Label text dynamically matches state
          textAlign: 'center'
      });
      
      // ROW 2: Control Button
      const rowBtn = this.mainGrid.addRow({ weight: 0.6 });
      
      if (!isPaired) {
          // --- UNPAIRED UI ---
          const btn = rowBtn.addTextButton({ 
              text: 'ADD DEVICE',  
              fontSize: 0.20,
              mode: 'center', // Fix jumping text
              backgroundColor: '#00AA00', 
              fontColor: '#FFFFFF',
              hoverColor: '#CCCCCC', // Light grey on hover
              selectedFontColor: '#FFFFFF',
              borderRadius: 0.05
          });
          btn.onTriggered = () => this.handleConfigClick();
          
      } else {
          // --- PAIRED UI ---
          const toggleBtn = rowBtn.addCol({weight: 0.5}).addTextButton({
              text: isOn ? "TURN OFF" : "TURN ON",
              fontSize: 0.20,
              mode: 'center', // Fix jumping text
              backgroundColor: '#333333', // Uniform button color
              fontColor: '#FFFFFF', // Always white to be readable
              hoverColor: '#CCCCCC', // Light grey on hover
              selectedFontColor: '#FFFFFF',
              borderRadius: 0.05
          });
          toggleBtn.onTriggered = () => this.toggle();

          const unpairBtn = rowBtn.addCol({weight: 0.5}).addTextButton({ 
              text: 'UNPAIR', 
              fontSize: 0.20,
              mode: 'center', // Fix jumping text
              backgroundColor: '#CC0000', 
              fontColor: '#FFFFFF',
              hoverColor: '#CCCCCC', // Light grey on hover
              selectedFontColor: '#FFFFFF',
              borderRadius: 0.05
          });
          unpairBtn.onTriggered = () => this.handleConfigClick();
      }
  }

  handleConfigClick() {
      // Logic from `hud.checkClick` handler in main.js
      const vl = this;
      console.log("3D Config Clicked:", vl.label, vl);
      
      if (vl.realDevice) {
            // UNPAIR
            hud.speak("Unpairing device...");
            hud.log(`Unpairing ${vl.realDevice.id}...`, '#FFFF00');
            
            smartHome.unpairDevice(vl.realDevice.id).then(success => {
                if (success) {
                    hud.speak("Device Unpaired.");
                    hud.log("Unpaired & Removed.", '#00FF00');
                    
                    vl.realDevice = null;
                    vl.linkedNodeId = null; 
                    vl.isOn = false;        
                    
                    vl.updateVisuals();
                    setTimeout(refreshRealDevices, 500);
                } else {
                    hud.speak("Unpair Failed.");
                }
            });
      } else {
            // PAIR
            if (!keypad.visible) {
                 if (!keypad.mesh) keypad.init(xb.scene);
                 
                 hud.speak("Enter Pairing Code.");
                 
                 // Position keypad near the light
                 const lightPos = new THREE.Vector3();
                 
                 // FIX: use 'vl' (Group) - Fixed Crash
                 vl.getWorldPosition(lightPos);
                 keypad.group.position.copy(lightPos).add(new THREE.Vector3(0.6, 0, 0.5));
                 
                 let cam = xb.camera;
                 if (xb.renderer && xb.renderer.xr && xb.renderer.xr.isPresenting) {
                     cam = xb.renderer.xr.getCamera();
                 }
                 
                 if (cam) {
                     const camPos = new THREE.Vector3();
                     cam.getWorldPosition(camPos);
                     keypad.group.lookAt(camPos);
                     
                     // Console log for debugging the exact coordinates
                     console.log(`[Keypad Debug] Spawning at ${keypad.group.position.toArray().map(n=>Math.round(n*100)/100).join(',')}, looking at camera at ${camPos.toArray().map(n=>Math.round(n*100)/100).join(',')}`);
                 }

                 keypad.open("", (code) => {
                      if (code) {
                          hud.speak("Pairing device...");
                          hud.log("Pairing...", '#FFFF00');
                          
                          smartHome.commissionDevice(code, vl.label).then(res => {
                               if (res.success) {
                                  hud.speak("Success! Paired.");
                                  hud.log("Paired!", '#00FF00');
                                  vl.linkedNodeId = res.nodeId;
                                  vl.updateVisuals(); // Instantly swap UI state
                                  refreshRealDevices();
                              } else {
                                  hud.speak("Pairing Failed.");
                                  hud.log("Error: " + (res.error?.message || "Unknown"), '#FF0000');
                              }
                          });
                      } else {
                          hud.speak("Pairing cancelled.");
                      }
                 }, () => {
                     hud.speak("Cancelled.");
                 });
             }
      }
  }

  updateVisuals() {
      // if (!this.mesh) return; // Mesh removed
      
      const isPaired = !!(this.realDevice || this.linkedNodeId);
      
      // Hydrate state from realDevice if available BEFORE rebuilding buttons
      if (this.realDevice && this.realDevice.traits && this.realDevice.traits['sdm.devices.traits.OnOff']) {
          this.isOn = this.realDevice.traits['sdm.devices.traits.OnOff'].isOn;
      }
      
      const isOn = this.isOn;
      
      let colorStr = '#FFFF00'; // Yellow (Unpaired)
      if (isPaired) {
          colorStr = isOn ? '#FFFFFF' : '#00FF00';
      }
      
      this.stateColor = colorStr;
      
      // Rebuild Panel to update Text/Icon
      this.rebuildPanel();
  }

  toggle() {
      this.isOn = !this.isOn;
      this.updateVisuals();
      
      if (this.realDevice && smartHome) {
          console.log(`[Toggle] 3D Light ${this.labelText} -> ${this.isOn}`);
          
          const stateStr = this.isOn ? "ON" : "OFF";
          const colorStr = this.isOn ? '#FFFFFF' : '#00FF00';
          hud.log(`${this.labelText} turned ${stateStr}`, colorStr);
          
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
  
  checkClick() { return false; }
}


// --- Main App Logic ---

let isAppInitialized = false;

async function initApp() {
    if (isAppInitialized) {
        console.warn("initApp called multiple times. Ignoring.");
        return;
    }
    isAppInitialized = true;

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
    // Enable Ray Visualization to fix "invisible pointer" issue
    o.controllers.visualizeRays = true;

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
        
        // 6b. Menu (2D) - Uses standard browser prompts, no class needed
        // menu.init(document.body, '2D'); // REMOVED
        
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
                
                console.log("HUD: 3D Plane Attached to Scene/Camera");
                
                // 6b. Keypad Init only on demand
                // menu.init(xb.scene || parent); // REMOVED
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

    vision.onLightsFound = (lights, cameraMatrix) => {
        // Critical: If user stopped scanning, IGNORE result to prevent clearing lights
        if (!isScanning) {
            console.log("Scan stopped. Ignoring late result.");
            return;
        }

        // hud.drawLights(lights); // Removed to prevent index mismatch (Wait for spawnVirtualLights -> link -> draw)
        hud.speak(`Found ${lights.length} lights.`);
        spawnVirtualLights(lights, cameraMatrix);
    };

    hud.log("Vision System Started");
    hud.speak("Vision System Ready. Say 'Scan' or click button.");
    hud.log("Ready. Click Scan to Start.");
    
    // Decoupled Scanning Logic:
    // 1. Fast Capture Loop (300ms) - Keeps frame buffer fresh / "Live"
    // 2. Slow Analysis Loop (5000ms) - Sends latest frame to API

    // Buffers are now global

    // Fast Capture Loop
    let isCapturing = false;

    // --- XR 3D CAPTURE LOOP ---
    // Fast capture to freeze camera matrix for precise 3D placement
    setInterval(async () => {
        if (!isScanning || hud.mode === '2D') return;
        if (isCapturing) return; // SKIP if previous capture is still running
        
        isCapturing = true;
        const canvas = document.getElementById('process-canvas');
        
        try {
            let blob = null;
            
            try {
                const app = xb.core;
                if (app && app.screenshotSynthesizer) {
                    if (!app.deviceCamera || !app.deviceCamera.loaded) {
                         // console.log("[FastLoop] Waiting for deviceCamera to finish loading...");
                    } else {
                        // Attempting XR native screenshot. Note: The background may be frozen if the browser paused the getUserMedia video track.
                        // However, on many browsers (like Chrome Android), `deviceCamera.texture` still receives frames naturally.
                        const dataUri = await app.screenshotSynthesizer.getScreenshot(true);
                        if (dataUri && dataUri.length > 50) { // Check that it's not a tiny empty base64
                            const res = await fetch(dataUri);
                            blob = await res.blob();
                        }
                    } 
                }
            } catch (xrError) {
                console.warn("[FastLoop] XR Screenshot Synthesizer failed:", xrError);
            }
            
            // Fallback just in case, though the 2D loop handles non-XR normally
            if (!blob && camera.videoElement && camera.videoElement.readyState >= 2) {
                 blob = await camera.captureFrame(canvas, false); 
            }
            
            if (blob) {
                latestFrameBlob = blob;
                
                let cam = null;
                if (xb.renderer && xb.renderer.xr && xb.renderer.xr.isPresenting) {
                     cam = xb.renderer.xr.getCamera();
                } else {
                     try { cam = xb.core?.camera || xb.camera; } catch(e) {}
                }
                
                if (cam) {
                    cam.updateMatrixWorld(true);
                    latestCameraMatrix = cam.matrixWorld.clone();
                }
            }
        } catch (e) {
            console.warn("Fast Capture Loop Error:", e);
        } finally {
            isCapturing = false;
        }
    }, 300);

    // --- XR 3D ANALYSIS LOOP ---
    setInterval(() => {
        if (!isScanning || hud.mode === '2D') return;
        
        if (latestFrameBlob && latestCameraMatrix) {
            console.log("Scanning 3D (using latest frame & matrix)..."); 
            const matrixToPass = latestCameraMatrix.clone();
            vision.analyzeFrame(latestFrameBlob, matrixToPass);
            
            latestFrameBlob = null; 
        }
    }, 5000);

    // --- 2D DESKTOP CAPTURE & ANALYSIS LOOP ---
    // Matches exact behavior of commit 3d289675a
    setInterval(async () => {
        if (!isScanning || hud.mode !== '2D') return;
        
        const canvas = document.getElementById('process-canvas');
        if (!camera.videoElement || camera.videoElement.readyState < 2) return;
        
        const blob = await camera.captureFrame(canvas, false); 
        if (blob) {
            console.log("Scanning 2D...");
            hud.log("Scanning...", '#888888');
            vision.analyzeFrame(blob);
        }
    }, 5000);

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

// Re-entry Guard
let isToggling = false;

async function toggleScan() {
    if (isToggling) return;
    isToggling = true;

    // Determine target state based on current state
    const targetState = !isScanning;
    
    if (targetState) {
        // --- STARTING SCAN ---
        hud.log("Starting Camera...", '#FFFF00');
        
        // 1. Flush Logic (Before setting isScanning = true)
        // This prevents the fast loop from grabbing a stale frame while we flush
        latestFrameBlob = null;
        latestCameraMatrix = null;
        
        try {
            if (hud.mode !== '2D') {
                // Pre-warm / Flush XR Synthesizer
                const app = xb.core;
                if (app && app.screenshotSynthesizer) {
                    if (app.deviceCamera && app.deviceCamera.loaded) {
                         console.log("Flushing XR Screenshot Synthesizer...");
                         await app.screenshotSynthesizer.getScreenshot(true);
                         console.log("XR Screenshot Synthesizer Flushed.");
                    }
                }
            } else {
                const canvas = document.getElementById('process-canvas');
                await camera.captureFrame(canvas, false); 
            }
            console.log("Camera Flushed. ready to start.");
        } catch(e) {
            console.warn("Camera Flush failed", e);
        }

        // 2. Enable Scanning (Now safe)
        isScanning = true;
        
        // Update UI
        if (hud && hud.setScanState) hud.setScanState(true);
        hud.speak("Scanning started. Please pan around.");
        hud.log("Scanning Active...", '#00FF00');

    } else {
        // --- STOPPING SCAN ---
        isScanning = false;
        
        // Update UI
        if (hud && hud.setScanState) hud.setScanState(false);
        hud.speak("Scanning paused. Configure lights.");
        hud.speak("Scanning paused. Configure lights.");
        hud.log("Scanning Paused", '#FFFF00');
    }
    
    isToggling = false;
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


// Updated spawnVirtualLights to use Historical Matrix
async function spawnVirtualLights(lights, cameraMatrix) {
    if (!lights) return;
    
    console.log("[Spawn] Update Virtual Lights", lights);

    // Check Mode
    const is3D = (hud.mode === '3D');

    const keptLights = [];
    const newCandidates = [];
    
    // Keep lights that are already linked (Paired)
    for (const vl of virtualLights) {
        if (vl.linkedNodeId) {
            keptLights.push(vl);
        } else {
            // Remove unlinked ones from scene to be replaced
            // FIXED: Remove regardless of vl.mesh existence (since we removed mesh from 3D lights)
            if (vl.parent) vl.parent.remove(vl); // Standard Three.js remove
            else {
                // Try xb.remove if available, or scene remove
                try { xb.remove(vl); } catch(e) { 
                    if (xb.scene) xb.scene.remove(vl);
                }
            }
            
            // Dispose if possible
            if (vl.mesh) {
                if (vl.mesh.geometry) vl.mesh.geometry.dispose();
                if (vl.mesh.material) vl.mesh.material.dispose();
            }
            
            // Dispose Panel if exists
            if (vl.panel) {
                 // xb.SpatialPanel might have dispose?
                 if (vl.panel.dispose) vl.panel.dispose();
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
            // Unproject Bounding Box Center
            const cx = (l.xmin + l.xmax) / 2;
            const cy = (l.ymin + l.ymax) / 2;
    

            // Default Depth (In Front of User)
            // OpenGL: -Z is Forward. 
            const z = -4.8; 
            
            // Get Camera
            let cam = null;
            try {
                if (xb.renderer && xb.renderer.xr && xb.renderer.xr.isPresenting) {
                    cam = xb.renderer.xr.getCamera();
                }
            } catch (err) { console.warn("[Spawn] XR Camera error:", err); }
            
            if (!cam) {
                cam = xb.camera; // Fallback to main camera
            }
            // Force a valid camera object if missing? 
            // If xb.camera is also null, we are in trouble.

            let vH = 1.8; 
            let vW = 3.2; 
            
            if (cam && cam.isPerspectiveCamera) {
                vH = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * Math.abs(z);
                vW = vH * cam.aspect;
            }

            const x = (cx - 0.5) * vW; 
            const y = -(cy - 0.5) * vH; 
            
            // Calculate physical dimensions correctly based on depth and FOV
            const physicalW = Math.max(0.6, (l.xmax - l.xmin) * vW);
            const physicalH = Math.max(0.3, (l.ymax - l.ymin) * vH);

            const vLight = new VirtualLight3D(l, label, physicalW, physicalH);
            
            // POSITIONING FIX: Use Historical Camera Matrix correctly 
            if (cameraMatrix) {
                 // The coordinates (x, y, z) are relative to the camera AT THE TIME OF CAPTURE
                 vLight.position.set(x, y, z);
                 
                 // Apply the exact transform the camera had when it took the photo
                 vLight.applyMatrix4(cameraMatrix);
                 
                 // Make the panel face the user's *current* position so they can read it
                 let currentCam = xb.camera;
                 try {
                     if (xb.renderer && xb.renderer.xr && xb.renderer.xr.isPresenting) {
                         currentCam = xb.renderer.xr.getCamera();
                     }
                 } catch (err) {}
                 if (currentCam) vLight.lookAt(currentCam.position);
                 
                 console.log(`[Spawn] Placed '${label}' via Historical Matrix at`, vLight.position);
            } else if (cam) {
                 // Fallback if no matrix was saved during capture (shouldn't happen with the fast loop fix)
                 const camPos = new THREE.Vector3();
                 const camDir = new THREE.Vector3();
                 cam.getWorldPosition(camPos);
                 cam.getWorldDirection(camDir);
                 
                 const basePos = camPos.clone().add(camDir.multiplyScalar(4.8));
                 
                 vLight.position.copy(basePos);
                 vLight.lookAt(camPos); 
                 
                 console.log(`[Spawn] Placed '${label}' via Fallback Math at`, vLight.position);
            } else {
                 console.warn(`[Spawn] No Camera! Using Safe Center with Offset.`);
                 vLight.position.set(x, 1.6 + y, z); 
            }
            
            // CRITICAL: Interaction Logic
            // Disable interaction on the container group to prevent drag
            vLight.isInteractive = false; 
            vLight.isDraggable = false;
            vLight.isRotatable = false;
            
            // Re-enable interaction on Panel ONLY (handled in class)
            // But explicitly disable drag and grab there too.
            if (vLight.traverse) {
                vLight.traverse(child => {
                     // Don't disable isInteractive on children, or buttons break!
                     // But do disable drag/grab.
                    child.isDraggable = false;
                    child.isRotatable = false;
                    child.isGrabbable = false;
                });
            }
            
            virtualLights.push(vLight);
            xb.add(vLight); 
            console.log(`[Spawn] Added 3D Light '${label}' at ${vLight.position.x.toFixed(2)}, ${vLight.position.y.toFixed(2)}, ${vLight.position.z.toFixed(2)}`);
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
            const pinchCenter = new THREE.Vector3().addVectors(indexTip, thumbTip).multiplyScalar(0.5);

            // A0. Check Keypad Interaction (Highest Priority)
            if (keypad.visible && keypad.mesh) {
                const keypadPos = new THREE.Vector3();
                keypad.mesh.getWorldPosition(keypadPos);
                
                // Distance check (Assume 0.8x0.8 plane)
                if (Math.abs(pinchCenter.z - keypadPos.z) < 0.1 && 
                    Math.abs(pinchCenter.x - keypadPos.x) < 0.4 && 
                    Math.abs(pinchCenter.y - keypadPos.y) < 0.4) {
                    
                    if (isPinching && !keypad.lastPinch) {
                         const localX = pinchCenter.x - (keypadPos.x - 0.4); 
                         const localY = pinchCenter.y - (keypadPos.y - 0.4);
                         
                         // Map to 0..1 (Width/Height is 0.8)
                         const u = Math.max(0, Math.min(1, localX / 0.8));
                         const v = Math.max(0, Math.min(1, localY / 0.8));
                         
                         keypad.handleClick({x: u, y: v});
                    }
                    keypad.lastPinch = isPinching;
                    continue; 
                }
            }
            
            // Menu Interaction Removed (Direct Keypad used)

            // B. Check against lights
            for (const vl of virtualLights) {
                // Get world position of light mesh
                const lightPos = new THREE.Vector3();
                vl.mesh.getWorldPosition(lightPos);
                
                // 1. Check Icon Hit (Pairing)
                let iconHit = false;
                if (vl.iconHitMesh) {
                     const iconPos = new THREE.Vector3();
                     vl.iconHitMesh.getWorldPosition(iconPos);
                     if (pinchCenter.distanceTo(iconPos) < 0.15) { // 15cm radius around icon
                          iconHit = true;
                          if (isPinching && !vl.lastPinch) {
                              console.log("Pinch Icon -> Configure");
                              startAssignmentFlow(vl);
                          }
                     }
                }
                
                if (iconHit) {
                    vl.lastPinch = isPinching;
                    continue; 
                }

                // 2. Check Main Mesh Hit (Toggle)
                const distToLight = pinchCenter.distanceTo(lightPos);
                
                if (distToLight < 0.3) { // 30cm interaction radius (Box)
                    if (isPinching && !vl.lastPinch) {
                        // Pinch Start -> Toggle
                        vl.toggle();
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
    // if (menu.visible) return; // REMOVED: menu is undefined

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
                // --- UNPAIR FLOW ---
                hud.speak("Unpairing device...");
                hud.log(`Unpairing ${vl.realDevice.id}...`, '#FFFF00');
                
                smartHome.unpairDevice(vl.realDevice.id).then(success => {
                    if (success) {
                        hud.speak("Device Unpaired.");
                        hud.log("Unpaired & Removed.", '#00FF00');
                        
                        // Reset State fully
                        vl.realDevice = null;
                        vl.linkedNodeId = null; 
                        vl.isOn = false;        
                        
                        if (vl.updateVisuals) vl.updateVisuals();
                        if (hud && hud.drawLights) hud.drawLights(virtualLights);
                        setTimeout(refreshRealDevices, 500);
                    } else {
                        hud.speak("Unpair Failed.");
                    }
                });
            } else {
                // --- PAIR FLOW ---
                if (hud.mode === '3D') {
                     // 3D MODE: Direct Keypad (No Menu)
                     if (!keypad.visible) {
                         // Initialize if needed
                         if (!keypad.mesh) keypad.init(xb.scene);
                         
                         hud.speak("Enter Pairing Code.");
                         
                         // Position keypad near the light
                         if (vl.mesh) {
                             const lightPos = new THREE.Vector3();
                             vl.mesh.getWorldPosition(lightPos);
                             
                             const camPos = new THREE.Vector3();
                             let cam = xb.camera;
                             if (xb.renderer && xb.renderer.xr && xb.renderer.xr.isPresenting) {
                                 cam = xb.renderer.xr.getCamera();
                             }
                             cam.getWorldPosition(camPos);
                             
                             // Spawn 0.4m right, 0.4m towards camera
                             const dir = new THREE.Vector3().subVectors(camPos, lightPos).normalize();
                             dir.y = 0; // Keep horizontal offset
                             keypad.group.position.copy(lightPos).add(dir.multiplyScalar(0.4)).add(new THREE.Vector3(0.4, 0, 0));
                             
                             // Face the user's headset perfectly
                             keypad.group.lookAt(camPos); 
                             
                             console.log(`[Keypad Legacy] Spawned at ${keypad.group.position.toArray().map(n=>n.toFixed(2))} facing headset at ${camPos.toArray().map(n=>n.toFixed(2))}`);
                         }

                         keypad.open("", (code) => {
                              if (code) {
                                  hud.speak("Pairing device...");
                                  hud.log("Pairing...", '#FFFF00');
                                  
                                  smartHome.commissionDevice(code, vl.label).then(res => {
                                       if (res.success) {
                                          hud.speak("Success! Paired and Linked.");
                                          hud.log("Paired!", '#00FF00');
                                          vl.linkedNodeId = res.nodeId;
                                          refreshRealDevices();
                                      } else {
                                          hud.speak("Pairing Failed.");
                                          hud.log("Error: " + (res.error?.message || "Unknown"), '#FF0000');
                                      }
                                  });
                              } else {
                                  hud.speak("Pairing cancelled.");
                              }
                         }, () => {
                             hud.speak("Cancelled.");
                         });
                     }
                } else {
                    // 2D MODE: Prompt
                    const code = prompt("Enter 11 or 21-digit Matter Pairing Code:");
                    if (code) {
                        hud.speak("Pairing device...");
                        hud.log("Pairing...", '#FFFF00');
                        
                        smartHome.commissionDevice(code, vl.label).then(res => {
                             if (res.success) {
                                hud.speak("Success! Logic Pairing Complete.");
                                hud.log("Paired!", '#00FF00');
                                vl.linkedNodeId = res.nodeId;
                                refreshRealDevices();
                            } else {
                                hud.speak("Pairing Failed.");
                                hud.log("Error: " + (res.error?.message || "Unknown"), '#FF0000');
                            }
                        });
                    }
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
