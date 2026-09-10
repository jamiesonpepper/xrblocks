/**
 * main.js
 * Entry point for XRHome.
 */

import { EasterEggManager } from './managers.js';

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
        if (dragController && dragController.userData.selected) {
            const objectToMove = dragController.userData.selected;
            
            // Get controller world pos/rot
            const cPos = new THREE.Vector3();
            const cQuat = new THREE.Quaternion();
            dragController.getWorldPosition(cPos);
            dragController.getWorldQuaternion(cQuat);
            
            // Apply local offset stored in dragOffset (rotated)
            const v = dragOffset.clone().applyQuaternion(cQuat);
            objectToMove.position.copy(cPos).add(v);
            
            // Lock rotation to face user or keep relative? Keep relative to controller is naturally easiest for "grabbing"
            objectToMove.quaternion.copy(cQuat).multiply(dragQuaternion);
            
            // Force Panel Matrix World sync to ensure hitting raycasts align with visible location immediately
            if (objectToMove.updateMatrixWorld) objectToMove.updateMatrixWorld(true);
        }
    }
}

function onXRSelectStart(event) {
    const controller = event.target;
    
    function isDescendant(obj, root) {
        let curr = obj;
        while (curr) {
            if (curr === root) return true;
            curr = curr.parent;
        }
        return false;
    }

    // Helper to see if user clicked a button or interactive slider
    function isInteractive(obj, root) {
        // 1. Check logical mapping via UIBlocks interaction registry if available
        try {
            if (typeof xb !== 'undefined' && xb.core && xb.core.interaction && xb.core.interaction.registry) {
                const resolved = xb.core.interaction.registry.resolve(obj);
                if (resolved && resolved.logical) {
                    const el = resolved.logical;
                    if (el.onClick || el.onInput || el.onChange || el.name === 'UIButton' || el.name === 'UISlider' || (el.userData && el.userData.interactive)) {
                        return true;
                    }
                }
            }
        } catch (e) {}

        // 2. Walk up Three.js parent hierarchy
        let curr = obj;
        while (curr && curr !== root) {
            if (curr.onClick || curr.onInput || curr.onChange || curr.name === 'UIButton' || curr.name === 'UISlider' || (curr.userData && curr.userData.interactive)) {
                return true;
            }
            curr = curr.parent;
        }
        return false;
    }

    // Define draggables: HUD, Keypad, and any unlinked Virtual Light panels
    const draggables = [];
    if (hud && hud.panel) draggables.push(hud.panel);
    if (keypad && keypad.panel) draggables.push(keypad.panel);
    if (virtualLights && virtualLights.length > 0) {
        for (const vl of virtualLights) {
            if (!vl.linkedNodeId && vl.panel) {
                draggables.push(vl.panel);
            }
        }
    }

    tempMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    const intersects = raycaster.intersectObjects(draggables, true);

    if (intersects.length > 0) {
        const hit = intersects[0];
        
        // 1. HUD Panel (Grab anywhere on card, unless clicking scan or toggle button)
        if (hud && hud.panel && (hit.object === hud.panel || isDescendant(hit.object, hud.panel))) {
            if (!isInteractive(hit.object, hud.panel)) {
                dragController = controller;
                const objectToMove = hud.panel;
                dragController.userData.selected = objectToMove;
                
                const cPos = new THREE.Vector3();
                const cQuat = new THREE.Quaternion();
                controller.getWorldPosition(cPos);
                controller.getWorldQuaternion(cQuat);
                
                dragOffset.copy(objectToMove.position).sub(cPos).applyQuaternion(cQuat.clone().invert());
                dragQuaternion.copy(cQuat.clone().invert()).multiply(objectToMove.quaternion);
                return;
            }
        }

        // 2. Keypad Panel
        if (keypad && keypad.panel && (hit.object === keypad.panel || isDescendant(hit.object, keypad.panel))) {
            if (!isInteractive(hit.object, keypad.panel)) {
                dragController = controller;
                const objectToMove = keypad.panel;
                dragController.userData.selected = objectToMove;
                
                const cPos = new THREE.Vector3();
                const cQuat = new THREE.Quaternion();
                controller.getWorldPosition(cPos);
                controller.getWorldQuaternion(cQuat);
                
                dragOffset.copy(objectToMove.position).sub(cPos).applyQuaternion(cQuat.clone().invert());
                dragQuaternion.copy(cQuat.clone().invert()).multiply(objectToMove.quaternion);
                return;
            }
        }

        // 3. Unlinked Virtual Light: Move the entire VirtualLight3D group directly so position is preserved!
        if (virtualLights && virtualLights.length > 0) {
            for (const vl of virtualLights) {
                if (!vl.linkedNodeId && vl.panel && (hit.object === vl.panel || isDescendant(hit.object, vl.panel))) {
                    if (!isInteractive(hit.object, vl.panel)) {
                        dragController = controller;
                        const objectToMove = vl; // Move group in world space
                        vl.hasBeenMoved = true;
                        dragController.userData.selected = objectToMove;
                        
                        const cPos = new THREE.Vector3();
                        const cQuat = new THREE.Quaternion();
                        controller.getWorldPosition(cPos);
                        controller.getWorldQuaternion(cQuat);
                        
                        dragOffset.copy(objectToMove.position).sub(cPos).applyQuaternion(cQuat.clone().invert());
                        dragQuaternion.copy(cQuat.clone().invert()).multiply(objectToMove.quaternion);
                        return;
                    }
                }
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
    if (keypad.visible && keypad.panel && keypad.panel.mesh) {
        const keypadIntersects = raycaster.intersectObject(keypad.panel.mesh);
        if (keypadIntersects.length > 0) {
            const hit = keypadIntersects[0];
            // UV to 0..1
            if (hit.uv) {
                keypad.handleClick(hit.uv);
            }
            return; // Consume event
        }
    }
}

import * as xb from 'xrblocks';
import { AuthManager } from './auth.js';
import { CameraManager } from './webrtc.js';
import { VisionManager } from './vision.js?v=25';
import { FirebaseHAIntegration } from './services/firebase-ha-integration.js?v=25';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { HUDManager } from './hud.js?v=25';
import { VirtualKeypad } from './keypad.js?v=25';

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
async function setupUI() {
    const overlay = document.getElementById('config-overlay');
    const startBtn = document.getElementById('start-btn');
    const geminiInput = document.getElementById('gemini-key');
    const matterInput = document.getElementById('matter-code');

    // 1. Fetch Cloud Function backend config first so headsets auto-load without manual key entry
    let backendConfig = null;
    try {
        const configRes = await fetch('https://us-central1-xrhome-009ef8.cloudfunctions.net/getConfig');
        if (configRes.ok) {
            backendConfig = await configRes.json();
            if (backendConfig.geminiKey && !auth.config.geminiKey) {
                auth.config.geminiKey = backendConfig.geminiKey;
                auth.saveConfig(auth.config);
            }
        }
    } catch (e) {
        console.warn("Could not pre-fetch remote config in setupUI:", e);
    }

    if (auth.config.geminiKey) geminiInput.value = auth.config.geminiKey;
    if (auth.config.matterCode) matterInput.value = auth.config.matterCode;

    // Auto-start if configured (from Cloud Function or localStorage)
    if (auth.hasConfig()) {
         overlay.style.display = 'none';
         initApp(backendConfig);
         return;
    }

    startBtn.addEventListener('click', () => {
        const config = {
            geminiKey: geminiInput.value,
            matterCode: matterInput.value
        };
        auth.saveConfig(config);
        
        overlay.style.display = 'none';
        initApp(backendConfig);
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

function hslToRgb(h, s = 1.0, l = 0.5) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r1 = 0, g1 = 0, b1 = 0;
    if (h < 60) { r1 = c; g1 = x; b1 = 0; }
    else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
    else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
    else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
    else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
    else { r1 = c; g1 = 0; b1 = x; }
    return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

function kelvinToHex(k) {
    const temp = k / 100;
    let r, g, b;
    if (temp <= 66) {
        r = 255;
        g = Math.max(0, Math.min(255, 99.4708025861 * Math.log(temp) - 161.1195681661));
        b = temp <= 19 ? 0 : Math.max(0, Math.min(255, 138.5177312231 * Math.log(temp - 10) - 305.0447927307));
    } else {
        r = Math.max(0, Math.min(255, 329.698727446 * Math.pow(temp - 60, -0.1332047592)));
        g = Math.max(0, Math.min(255, 288.1221695283 * Math.pow(temp - 60, -0.0755148492)));
        b = 255;
    }
    const toHex = (n) => Math.round(n).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// --- 3D Virtual Light (AR/XR) ---
class VirtualLight3D extends THREE.Group {
  constructor(geminiData, labelText, width = 0.36, height = 0.5) {
      super();
      this.geminiData = geminiData; // Keep for xmin/xmax/ymin/ymax
      this.originalLabel = labelText || "Light";
      this.labelText = this.originalLabel;
      this.label = this.labelText; // Alias for pairing logic
      this.isOn = false;
      this.brightness = 100;
      this.colorTemp = 2700;
      this.currentHue = 0;
      this.realDevice = null;
      this.linkedNodeId = null; 
      this.isSelectingDevice = false;
      this.devicePage = 0;
      this.expandedAreas = new Set();
      this.hasBeenMoved = false;

      // 3. Label + Interface (UICard)
      this.panelWidth = width;
      this.panelHeight = height;
      this.panel = null;

      this.rebuildPanel();
      
      this.xmin = geminiData.xmin;
      this.xmax = geminiData.xmax;
      this.ymin = geminiData.ymin;
      this.ymax = geminiData.ymax;
  }
  
  rebuildPanel() {
      if (this.panel) {
          // Transfer any local displacement from dragging into the group world transform
          const worldPos = new THREE.Vector3();
          const worldQuat = new THREE.Quaternion();
          this.panel.getWorldPosition(worldPos);
          this.panel.getWorldQuaternion(worldQuat);
          if (this.parent) {
              this.parent.worldToLocal(worldPos);
          }
          if (this.position.distanceTo(worldPos) > 0.005) {
              this.hasBeenMoved = true;
              this.position.copy(worldPos);
              this.quaternion.copy(worldQuat);
          }
          this.remove(this.panel);
      }
      
      const isPaired = !!(this.realDevice || this.linkedNodeId);
      const canDrag = !isPaired && !isScanning;
      
      this.draggable = canDrag;
      this.draggingMode = 'TRANSLATING';
      this.dragFacingCamera = false;
      
      if (this.isSelectingDevice) {
          this._buildDeviceListUI();
          return;
      }
      
      const isOn = this.isOn;
      // Do not use yellow or green anymore; default to clean white
      const stateColor = this.stateColor !== undefined ? this.stateColor : '#FFFFFF';
      
      const labelText = new xb.UIText({
          text: this.labelText,
          style: {
              fontSize: 17,
              fontWeight: 'bold',
              color: stateColor,
              textAlign: 'center',
              width: '100%',
          }
      });
      
      const cardChildren = [labelText];
      
      if (!isPaired) {
          // --- UNPAIRED UI ---
          const btn = new xb.UIButton({
              label: 'Pair Device',
              icon: 'add_circle',
              ariaLabel: 'Pair Device',
              userData: { interactive: true },
              style: {
                  width: '100%',
                  height: 40,
                  borderRadius: 10,
                  backgroundColor: 'rgba(255, 255, 255, 0.18)',
                  borderWidth: 1,
                  borderColor: '#FFFFFF',
                  fontSize: 14,
                  fontWeight: 'bold',
              },
              onClick: () => this.handleConfigClick()
          });
          cardChildren.push(btn);
      } else {
          // --- PAIRED UI ---
          // 1. Power Toggle & Unpair (Equal size buttons with clean icons and text)
          const toggleBtn = new xb.UIButton({
              ariaLabel: isOn ? 'Turn Off' : 'Turn On',
              userData: { interactive: true },
              style: {
                  flexGrow: 1,
                  height: 36,
                  borderRadius: 8,
                  backgroundColor: isOn ? 'rgba(255, 255, 255, 0.32)' : 'rgba(255, 255, 255, 0.12)',
                  borderWidth: 1,
                  borderColor: isOn ? '#FFFFFF' : 'rgba(255, 255, 255, 0.5)',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
              },
              children: [
                  new xb.UIIcon({
                      icon: 'power_settings_new',
                      style: { width: 18, height: 18, color: '#FFFFFF' }
                  }),
                  new xb.UIText({
                      text: isOn ? 'ON' : 'OFF',
                      style: { fontSize: 14, fontWeight: 'bold', color: '#FFFFFF' }
                  })
              ],
              onClick: () => this.toggle()
          });

          const unpairBtn = new xb.UIButton({
              ariaLabel: 'Unpair device',
              userData: { interactive: true },
              style: {
                  flexGrow: 1,
                  height: 36,
                  borderRadius: 8,
                  backgroundColor: 'rgba(255, 255, 255, 0.16)',
                  borderWidth: 1,
                  borderColor: '#FFFFFF',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
              },
              children: [
                  new xb.UIIcon({
                      icon: 'link_off',
                      style: { width: 18, height: 18, color: '#FFFFFF' }
                  }),
                  new xb.UIText({
                      text: 'Unpair',
                      style: { fontSize: 14, fontWeight: 'bold', color: '#FFFFFF' }
                  })
              ],
              onClick: () => this.handleConfigClick()
          });
          
          cardChildren.push(new xb.UIPanel({
              style: { width: '100%', flexDirection: 'row', gap: 6 },
              children: [toggleBtn, unpairBtn]
          }));
          
          // 2. Brightness Slider
          const brightnessText = new xb.UIText({
              text: `☀️ ${this.brightness}%`,
              style: { fontSize: 13, fontWeight: 'bold', color: '#FFFFFF', width: '100%' }
          });
          const brightnessSlider = new xb.UISlider({
              ariaLabel: `${this.labelText} brightness`,
              min: 1,
              max: 100,
              step: 1,
              value: this.brightness,
              style: { width: '100%', height: 26 },
              onInput: (val) => {
                  brightnessText.text = `☀️ ${Math.round(val)}%`;
              },
              onChange: (val) => {
                  this.setBrightness(val);
              }
          });
          cardChildren.push(brightnessText);
          cardChildren.push(brightnessSlider);
          
          // 3. Rainbow Color Slider with Gradient Rainbow Bar & Dynamic Swatch
          const colorIndicator = new xb.UIPanel({
              style: {
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  backgroundColor: this.stateColor || '#FFFFFF',
                  borderWidth: 1,
                  borderColor: '#FFFFFF',
              }
          });
          const rainbowLabel = new xb.UIText({
              text: '🌈 Color',
              style: { fontSize: 13, fontWeight: 'bold', color: '#FFFFFF' }
          });
          const rainbowHeader = new xb.UIPanel({
              style: {
                  width: '100%',
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
              },
              children: [rainbowLabel, colorIndicator]
          });

          const rainbowSlider = new xb.UISlider({
              ariaLabel: `${this.labelText} rainbow color`,
              min: 0,
              max: 360,
              step: 1,
              value: this.currentHue !== undefined ? this.currentHue : 0,
              style: { width: '100%', height: 26 },
              onInput: (val) => {
                  this.currentHue = Math.round(val);
                  const [r, g, b] = hslToRgb(this.currentHue);
                  const toHex = (n) => n.toString(16).padStart(2, '0');
                  this.stateColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
                  labelText.style.color = this.stateColor;
                  colorIndicator.style.backgroundColor = this.stateColor;
              },
              onChange: (val) => {
                  this.currentHue = Math.round(val);
                  const [r, g, b] = hslToRgb(this.currentHue);
                  this.setColor(r, g, b);
              }
          });

          // Gradient rainbow track bar directly under the color slider
          const rainbowStops = [
              '#FF0000', '#FF3B00', '#FF7700', '#FFB300', '#FFEE00',
              '#A2FF00', '#26FF00', '#00FF66', '#00FFD0', '#00C8FF',
              '#0055FF', '#3700FF', '#9E00FF', '#FF00C4', '#FF0037'
          ];
          const rainbowSegments = rainbowStops.map((c, i) => new xb.UIPanel({
              style: {
                  flexGrow: 1,
                  height: 6,
                  backgroundColor: c,
                  borderRadius: i === 0 ? 3 : (i === rainbowStops.length - 1 ? 3 : 0),
              }
          }));
          const rainbowBar = new xb.UIPanel({
              style: {
                  width: '100%',
                  flexDirection: 'row',
                  height: 6,
                  borderRadius: 3,
                  overflow: 'hidden',
                  marginTop: -2,
                  marginBottom: 2,
              },
              children: rainbowSegments
          });

          cardChildren.push(rainbowHeader);
          cardChildren.push(rainbowSlider);
          cardChildren.push(rainbowBar);

          // 4. 6 Common Temperatures (Faithful physical light colors, no slider)
          const tempText = new xb.UIText({
              text: `🌡️ ${this.colorTemp || 2700}K`,
              style: { fontSize: 13, fontWeight: 'bold', color: '#FFFFFF', width: '100%' }
          });

          const tempPresets = [
              { kelvin: 2000, hex: '#FFA23A' }, // Candlelight warm amber
              { kelvin: 2700, hex: '#FFBF75' }, // Soft white incandescent
              { kelvin: 3500, hex: '#FFDDAA' }, // Neutral warm white
              { kelvin: 4500, hex: '#FFF2E5' }, // Pure neutral white
              { kelvin: 5500, hex: '#E8F0FE' }, // Daylight
              { kelvin: 6500, hex: '#A8CDFF' }, // Cool daylight sky blue
          ];

          const tempButtons = tempPresets.map(preset => new xb.UIButton({
              label: '',
              ariaLabel: `${preset.kelvin}K`,
              style: {
                  flexGrow: 1,
                  height: 26,
                  borderRadius: 6,
                  backgroundColor: preset.hex,
                  borderWidth: this.colorTemp === preset.kelvin ? 2 : 1,
                  borderColor: '#FFFFFF',
              },
              onClick: () => {
                  this.setColorTemp(preset.kelvin, preset.hex);
                  tempText.text = `🌡️ ${preset.kelvin}K`;
                  labelText.style.color = preset.hex;
                  colorIndicator.style.backgroundColor = preset.hex;
              }
          }));

          cardChildren.push(tempText);
          cardChildren.push(new xb.UIPanel({
              style: { width: '100%', flexDirection: 'row', gap: 4 },
              children: tempButtons
          }));
      }

      this.panel = new xb.UICard({
          size: { width: this.panelWidth, height: 'auto' },
          manipulation: canDrag,
          style: {
              flexDirection: 'column',
              gap: 8,
              padding: 12,
              backgroundColor: 'rgba(255, 255, 255, 0.12)',
              borderWidth: 1.5,
              borderColor: '#FFFFFF',
              borderRadius: 16,
          },
          children: cardChildren
      });

      // Center panel at 3D anchor position (closer to physical device)
      this.panel.position.set(0, 0, 0);
      this.add(this.panel);
  }

  handleConfigClick() {
      const vl = this;
      console.log("3D Config Clicked:", vl.label, vl);
      
      if (vl.realDevice) {
            // UNPAIR
            hud.speak("Unpairing device...");
            const devId = vl.realDevice.id;
            hud.log(`Unpairing ${devId}...`, '#FFFFFF');
            
            smartHome.unpairDevice(devId).then(success => {
                if (success) {
                    hud.speak("Device Unpaired.");
                    hud.log("Unpaired & Removed.", '#FFFFFF');
                    
                    if (auth.db && auth.user) {
                        try {
                            const ref = auth.db.ref(`users/${auth.user.uid}/anchors/${devId.replace(/\./g, '_')}`);
                            ref.remove();
                        } catch (e) {
                            console.warn("Anchor remove error:", e);
                        }
                    }
                    
                    vl.unpaired = true;
                    vl.realDevice = null;
                    vl.linkedNodeId = null; 
                    vl.isOn = false;
                    vl.labelText = vl.originalLabel || "Light";
                    vl.label = vl.labelText;
                    
                    vl.updateVisuals();
                    setTimeout(refreshRealDevices, 500);
                } else {
                    hud.speak("Unpair Failed.");
                }
            });
      } else {
            // ENTER SELECTION MODE
            this.isSelectingDevice = true;
            this.devicePage = 0;
            this.rebuildPanel();
      }
  }

  _buildDeviceListUI() {
      const allDevices = Array.from(smartHome.devices.values());
      const devices = allDevices.filter(d => d.id.startsWith('light.') || d.id.startsWith('switch.'));
      
      // 1. Group devices by Area
      const areaGroups = {};
      devices.forEach(d => {
          const area = d.area || 'Other';
          if (!areaGroups[area]) areaGroups[area] = [];
          areaGroups[area].push(d);
      });

      // 2. Sort Areas Alphabetically Ascending (A -> Z)
      const sortedAreas = Object.keys(areaGroups).sort((a, b) => a.localeCompare(b));

      // 3. Sort Devices within each area Alphabetically Ascending (A -> Z)
      sortedAreas.forEach(area => {
          areaGroups[area].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
      });

      if (!this.expandedAreas) this.expandedAreas = new Set();

      // 4. Build flattened list of visible tree nodes
      const visibleItems = [];
      sortedAreas.forEach(area => {
          const isExpanded = this.expandedAreas.has(area);
          const count = areaGroups[area].length;
          visibleItems.push({
              type: 'area',
              area,
              count,
              isExpanded
          });
          if (isExpanded) {
              areaGroups[area].forEach(dev => {
                  visibleItems.push({
                      type: 'device',
                      device: dev,
                      area
                  });
              });
          }
      });

      const ITEMS_PER_PAGE = 8;
      const totalPages = Math.ceil(visibleItems.length / ITEMS_PER_PAGE) || 1;
      if (this.devicePage >= totalPages) this.devicePage = Math.max(0, totalPages - 1);
      
      const startIdx = this.devicePage * ITEMS_PER_PAGE;
      const pageItems = visibleItems.slice(startIdx, startIdx + ITEMS_PER_PAGE);
      
      const headerRow = new xb.UIPanel({
          style: {
              width: '100%',
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
          },
          children: [
              new xb.UIText({ text: 'Select Device', style: { fontSize: 16, fontWeight: 'bold', color: '#FFFFFF' } }),
              new xb.UIButton({
                  label: '✕',
                  ariaLabel: 'Cancel selection',
                  style: { width: 30, height: 30, borderRadius: 6, borderWidth: 1, borderColor: '#FFFFFF', backgroundColor: 'rgba(255, 255, 255, 0.12)' },
                  onClick: () => {
                      this.isSelectingDevice = false;
                      this.rebuildPanel();
                  }
              })
          ]
      });

      const bodyChildren = [headerRow];
      
      if (devices.length === 0) {
          bodyChildren.push(new xb.UIText({ text: 'No Devices Found', style: { fontSize: 14, color: 'rgba(255, 255, 255, 0.7)', textAlign: 'center' } }));
          bodyChildren.push(new xb.UIText({ text: 'Ensure devices are linked in Home Assistant', style: { fontSize: 12, color: 'rgba(255, 255, 255, 0.5)', textAlign: 'center' } }));
      } else {
          pageItems.forEach(item => {
              if (item.type === 'area') {
                  bodyChildren.push(new xb.UIButton({
                      label: `${item.isExpanded ? '▼' : '▶'} ${item.area} (${item.count})`,
                      style: {
                          width: '100%',
                          height: 34,
                          borderRadius: 8,
                          backgroundColor: 'rgba(255, 255, 255, 0.18)',
                          borderWidth: 1,
                          borderColor: 'rgba(255, 255, 255, 0.7)',
                          fontSize: 14,
                          fontWeight: 'bold',
                      },
                      onClick: () => {
                          if (this.expandedAreas.has(item.area)) {
                              this.expandedAreas.delete(item.area);
                          } else {
                              this.expandedAreas.add(item.area);
                          }
                          this.rebuildPanel();
                      }
                  }));
              } else if (item.type === 'device') {
                  const dev = item.device;
                  bodyChildren.push(new xb.UIButton({
                      label: `  • ${dev.name || dev.id}`,
                      userData: { interactive: true },
                      style: {
                          width: '100%',
                          height: 34,
                          borderRadius: 6,
                          backgroundColor: 'rgba(255, 255, 255, 0.08)',
                          borderWidth: 1,
                          borderColor: 'rgba(255, 255, 255, 0.35)',
                          fontSize: 14,
                          fontWeight: 'bold',
                          color: '#FFFFFF',
                      },
                      onClick: () => this.pairWithDevice(dev.id)
                  }));
              }
          });
          
          if (totalPages > 1) {
              const prevBtn = new xb.UIButton({
                  label: '<',
                  disabled: this.devicePage <= 0,
                  style: { width: 40, height: 30, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.4)' },
                  onClick: () => { if (this.devicePage > 0) { this.devicePage--; this.rebuildPanel(); } }
              });
              const pageIndicator = new xb.UIText({
                  text: `${this.devicePage + 1} / ${totalPages}`,
                  style: { fontSize: 13, color: '#FFFFFF', textAlign: 'center', flexGrow: 1 }
              });
              const nextBtn = new xb.UIButton({
                  label: '>',
                  disabled: this.devicePage >= totalPages - 1,
                  style: { width: 40, height: 30, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.4)' },
                  onClick: () => { if (this.devicePage < totalPages - 1) { this.devicePage++; this.rebuildPanel(); } }
              });
              bodyChildren.push(new xb.UIPanel({
                  style: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
                  children: [prevBtn, pageIndicator, nextBtn]
              }));
          }
      }

      this.panel = new xb.UICard({
          size: { width: 0.38, height: 'auto' },
          manipulation: false,
          style: {
              flexDirection: 'column',
              gap: 8,
              padding: 12,
              backgroundColor: 'rgba(255, 255, 255, 0.12)',
              borderWidth: 1.5,
              borderColor: '#FFFFFF',
              borderRadius: 16,
          },
          children: bodyChildren
      });

      this.panel.position.set(0, 0, 0);
      this.add(this.panel);
  }

  pairWithDevice(deviceId) {
      hud.speak("Pairing device...");
      hud.log(`Pairing to ${deviceId}...`, '#FFFFFF');
      
      const device = smartHome.devices.get(deviceId);
      if (device) {
          this.unpaired = false;
          this.linkedNodeId = deviceId;
          this.realDevice = device;
          this.labelText = device.name || deviceId;
          this.label = this.labelText;
          this.isSelectingDevice = false;
          
          if (auth.db && auth.user) {
              const pos = this.position;
              const quat = this.quaternion;
              const ref = auth.db.ref(`users/${auth.user.uid}/anchors/${deviceId.replace(/\./g, '_')}`);
              ref.set({
                  position: { x: pos.x, y: pos.y, z: pos.z },
                  quaternion: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
                  timestamp: firebase.database.ServerValue.TIMESTAMP
              }).then(() => {
                  hud.log(`Saved coordinates`, '#FFFFFF');
              }).catch(err => {
                  console.error("Failed to save anchor", err);
              });
          }
          
          this.updateVisuals();
          refreshRealDevices();
      }
  }

  updateVisuals() {
      const isPaired = !!(this.realDevice || this.linkedNodeId);
      
      // Hydrate state from realDevice if available BEFORE rebuilding buttons
      if (this.realDevice) {
          this.isOn = this.realDevice.isOn;
          if (this.realDevice.brightness !== undefined) {
              this.brightness = this.realDevice.brightness;
          }
          if (this.realDevice.color_temp_kelvin) {
              this.colorTemp = this.realDevice.color_temp_kelvin;
          }
      }
      
      const isOn = this.isOn;
      
      let colorStr = '#FFFFFF';
      if (isPaired) {
          colorStr = isOn ? (this.colorTemp ? kelvinToHex(this.colorTemp) : '#FFFFFF') : 'rgba(255, 255, 255, 0.55)';
      }
      
      this.stateColor = colorStr;
      
      // Rebuild Panel to update Text/Icon/Sliders
      this.rebuildPanel();
  }

  toggle() {
      const nextOn = !this.isOn;
      this.isOn = nextOn;
      if (this.realDevice) {
          this.realDevice.isOn = nextOn;
      }
      this.updateVisuals();
      
      if (this.realDevice && smartHome) {
          console.log(`[Toggle] 3D Light ${this.labelText} -> ${nextOn}`);
          
          const stateStr = nextOn ? "ON" : "OFF";
          const colorStr = nextOn ? '#FFFFFF' : 'rgba(255, 255, 255, 0.55)';
          hud.log(`${this.labelText} turned ${stateStr}`, colorStr);
          
          smartHome.toggleLight(this.realDevice.id, nextOn).then((success) => {
              if (success !== false) {
                  hud.speak(nextOn ? "Turning On" : "Turning Off");
              } else {
                  // Revert on failure
                  hud.log(`Failed to toggle ${this.labelText}`, '#FF0000');
                  hud.speak("Device sync failed");
                  this.isOn = !nextOn;
                  if (this.realDevice) this.realDevice.isOn = !nextOn;
                  this.updateVisuals();
              }
          }).catch(() => {
              hud.log(`Network error syncing ${this.labelText}`, '#FF0000');
              this.isOn = !nextOn;
              if (this.realDevice) this.realDevice.isOn = !nextOn;
              this.updateVisuals();
          });
      } 
  }

  setBrightness(val) {
      const prevBrightness = this.brightness;
      this.brightness = Math.max(1, Math.min(100, Math.round(val)));
      if (this.realDevice && smartHome) {
          smartHome.setBrightness(this.realDevice.id, this.brightness).then((success) => {
              if (success !== false && this.realDevice) {
                  this.realDevice.brightness = this.brightness;
              } else if (success === false) {
                  this.brightness = prevBrightness;
                  hud.log(`Failed to set brightness for ${this.labelText}`, '#FF0000');
              }
          }).catch(() => {
              this.brightness = prevBrightness;
          });
      }
  }

  setColor(r, g, b) {
      if (this.realDevice && smartHome) {
          const prevColor = this.stateColor;
          const toHex = (n) => {
              const hex = n.toString(16);
              return hex.length === 1 ? '0' + hex : hex;
          };
          this.stateColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
          this.rebuildPanel();
          smartHome.setColor(this.realDevice.id, r, g, b).then((success) => {
              if (success === false) {
                  this.stateColor = prevColor;
                  this.rebuildPanel();
                  hud.log(`Failed to set color for ${this.labelText}`, '#FF0000');
              }
          }).catch(() => {
              this.stateColor = prevColor;
              this.rebuildPanel();
          });
      }
  }

  setColorTemp(kelvin, hexColor) {
      this.colorTemp = Math.round(kelvin);
      this.stateColor = hexColor || kelvinToHex(this.colorTemp);
      this.rebuildPanel();
      if (this.realDevice && smartHome) {
          hud.log(`Warmth set to ${this.colorTemp}K`, this.stateColor);
          smartHome.setColorTemp(this.realDevice.id, this.colorTemp).then((success) => {
              if (success !== false && this.realDevice) {
                  this.realDevice.color_temp_kelvin = this.colorTemp;
              }
          });
      }
  }
  
  checkClick() { return false; }
}


// --- Main App Logic ---

let isAppInitialized = false;

async function initApp(preloadedConfig = null) {
    if (isAppInitialized) {
        console.warn("initApp called multiple times. Ignoring.");
        return;
    }
    isAppInitialized = true;

    console.log("Initializing XRHome...");
    
    // Fetch Backend Config if not already preloaded
    let apiConfig = preloadedConfig;
    if (!apiConfig) {
        try {
            const configRes = await fetch('https://us-central1-xrhome-009ef8.cloudfunctions.net/getConfig');
            apiConfig = await configRes.json();
        } catch (e) {
            apiConfig = { projectId: 'xrhome-009ef8' };
        }
    }
    if (!apiConfig.projectId) apiConfig.projectId = 'xrhome-009ef8';

    if (apiConfig.geminiKey && !auth.config.geminiKey) {
        auth.config.geminiKey = apiConfig.geminiKey;
        auth.saveConfig(auth.config);
    }
    
    if (apiConfig.firebaseApiKey) {
        const firebaseConfig = {
            apiKey: apiConfig.firebaseApiKey,
            authDomain: `${apiConfig.projectId}.firebaseapp.com`,
            projectId: apiConfig.projectId,
        };
        smartHome = new FirebaseHAIntegration(apiConfig.projectId);
        await smartHome.listen();
        console.log(`Home Assistant Connected! Successfully retrieved ${smartHome.devices.size} devices.`);
        
        // Listen for device changes
        smartHome.onDevicesChanged = (devices) => {
            console.log("Devices updated via HA:", devices);
            refreshRealDevices();
        };
    } else {
        console.warn("No Firebase API Key found, skipping Firebase initialization.");
    }
    
    // 1. Fetch Real Devices (Local Cache from Firestore)
    await refreshRealDevices();

    // Check for AR Support FIRST before starting any cameras
    let isARSupported = false;
    if (navigator.xr) {
        try {
            isARSupported = await navigator.xr.isSessionSupported('immersive-ar');
        } catch(e) {
            console.warn("XR Check failed", e);
        }
    }
    console.log("AR Supported:", isARSupported);

    // 2. Start Camera (Only use webrtc.js if NOT in AR)
    if (!isARSupported) {
        console.log("Starting 2D Desktop Camera (webrtc.js)...");
        await camera.startCamera();
    }

    // 3. Init XRBlocks
    await RAPIER.init(); // Fix: No arguments
    const o = new xb.Options();
    // Enable Ray Visualization to fix "invisible pointer" issue
    o.controllers.visualizeRays = true;

    if (isARSupported) {
        if (typeof o.enableUI === 'function') o.enableUI();
        if (o.xrButton) {
            o.xrButton.enabled = true;
            o.xrButton.startText = 'Enter AR';
        }
        if (typeof o.enableCamera === 'function') {
            o.enableCamera();
        }
        o.referenceSpaceType = 'local-floor';
        console.log("Configured XRBlocks for AR with local-floor reference space.");
    } else {
        if (o.xrButton) {
            o.xrButton.enabled = false;
        }
        o.enableSimulator = false;
        // Desktop Mode: Create a transparent canvas manually
        if (!o.canvas) {
            o.canvas = document.createElement('canvas');
            o.canvas.id = 'xr-canvas';
            // Force transparency via context attributes - this is critical for WebGLRenderer
            const gl = o.canvas.getContext('webgl2', { alpha: true, antialias: true }) 
                    || o.canvas.getContext('webgl', { alpha: true, antialias: true });
        }
    }
    
    o.physics.RAPIER = RAPIER;
    o.physics.useEventQueue = true;
    o.physics.worldStep = true;
    o.hands.enabled = true; // Use Hands
    o.simulator.defaultMode = xb.SimulatorMode.POSE; // Or generic

    xb.init(o);

    // Mount custom heuristic Easter Egg
    const getDeps = () => ({ virtualLights, smartHome, hud, VirtualLight3D });
    xb.add(new EasterEggManager(getDeps));

    // Attach XR Interaction Listeners & Dragging Script
    setTimeout(() => {
        if (xb.renderer && xb.renderer.xr) {
            const controller0 = xb.renderer.xr.getController(0);
            const controller1 = xb.renderer.xr.getController(1);
            
            if (controller0 && controller1) {
                controller0.addEventListener('select', onXRSelect);
                controller1.addEventListener('select', onXRSelect);
                
                controller0.addEventListener('selectstart', onXRSelectStart);
                controller1.addEventListener('selectstart', onXRSelectStart);
                
                controller0.addEventListener('selectend', onXRSelectEnd);
                controller1.addEventListener('selectend', onXRSelectEnd);
                
                console.log("XR Interaction Listeners Attached to controllers");
            }
            xb.add(new HUDInteraction());
        }
    }, 1000);

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
    
    // 5. Init HUD
    if (!isARSupported) {
        // Desktop: 2D Overlay
        console.log("HUD: Initializing 2D Desktop Overlay...");
        hud.init(document.body, '2D');
        console.log("HUD: 2D Overlay Attached to Body");
    } else {
        // XR: 3D Plane
        setTimeout(() => {
             let app = null;
             try {
                if (typeof xb.get === 'function') {
                    app = xb.get();
                }
             } catch(e) {}
             
             const parent = app?.camera || xb.scene; 
             
             if (parent) {
                hud.init(parent, '3D');
                console.log("HUD: 3D Plane Attached to Scene/Camera");
             } else {
                console.warn("Could not find Camera or Scene for 3D HUD");
             }
        }, 500);
    }
    
    // 6. Init Vision Loop
    const activeGeminiKey = auth.config.geminiKey || apiConfig.geminiKey;
    vision.init(activeGeminiKey);
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

    const handleDevicesFound = (lights, cameraMatrix) => {
        if (!lights || lights.length === 0) {
            console.log("[Vision] 0 devices in result.");
            return;
        }

        console.log(`[Vision] Processing ${lights.length} detected devices...`);
        hud.speak(`Found ${lights.length} devices.`);
        hud.log(`Detected ${lights.length} devices`, '#00FF00');
        spawnVirtualLights(lights, cameraMatrix);
    };

    vision.onLightsFound = handleDevicesFound;
    vision.onDevicesFound = handleDevicesFound;

    hud.speak("Vision System Ready. Click button to scan.");
    
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
                if (app && app.deviceCamera && app.deviceCamera.loaded && app.deviceCamera.video) {
                    const video = app.deviceCamera.video;
                    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
                        try {
                            const ctx = canvas.getContext('2d', { willReadFrequently: true });
                            // Calculate scale to maintain aspect ratio within 640px width
                            const scale = 640 / video.videoWidth;
                            canvas.width = 640;
                            canvas.height = video.videoHeight * scale;
                            
                            // Draw the raw, un-3D-rendered video straight to the canvas
                            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                            
                            // Convert directly to Blob for the Vision API
                            blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
                        } catch (drawErr) {
                            console.warn("[FastLoop] Native Video to Canvas draw failed:", drawErr);
                        }
                    }
                }
            } catch (err) {
                console.warn("[FastLoop] DeviceCamera direct capture failed:", err);
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
    // Voice Command Setup removed
}

// Keep-alive reference for AR Video frames
let hiddenCameraKeepalive = null;

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
        
        // 0. Cleanup Unmapped Anchors from PREVIOUS session
        const unmappedLights = virtualLights.filter(vl => !vl.realDevice && !vl.linkedNodeId);
        unmappedLights.forEach(vl => {
            if (vl.parent) {
                vl.parent.remove(vl);
            } else if (xb.scene) {
                xb.scene.remove(vl);
            }
        });
        if (unmappedLights.length > 0) {
            hud.log(`Cleaned up ${unmappedLights.length} unmapped anchors.`, '#FF8800');
        }
        
        // Keep only mapped lights
        virtualLights = virtualLights.filter(vl => vl.realDevice || vl.linkedNodeId);

        // 1. Flush Logic (Before setting isScanning = true)
        // This prevents the fast loop from grabbing a stale frame while we flush
        latestFrameBlob = null;
        latestCameraMatrix = null;
        
        // 1b. Lifecycle: Inject hidden VideoView to force WebGL to poll AR frames
        if (hud.mode !== '2D') {
            const app = xb.core;
            if (app && app.deviceCamera && app.deviceCamera.loaded) {
                const video = app.deviceCamera.video;
                
                if (video) {
                    hud.log("Waking up camera hardware...", '#FFFF00');
                    
                    // Force the video element to try playing if it was suspended
                    video.play().catch(e => console.warn("Video play failed:", e));
                    
                    // Attach to DOM invisibly to signal the browser compositor to decode frames
                    video.style.position = 'absolute';
                    video.style.opacity = '0.01';
                    video.style.width = '1px';
                    video.style.height = '1px';
                    video.style.pointerEvents = 'none';
                    if (!video.parentNode) {
                        document.body.appendChild(video);
                    }
                    
                    console.log("[DEBUG-SCAN] Starting 2-frame hardware wait...");
                    const hardwareWaitStart = performance.now();
                    // Wait for 2 freshly decoded hardware frames to prove the pipeline is flushed
                    await new Promise(resolve => {
                        let frames = 0;
                        const onFrame = () => {
                            frames++;
                            if (frames >= 2) {
                                resolve();
                            } else if (video.requestVideoFrameCallback) {
                                video.requestVideoFrameCallback(onFrame);
                            } else {
                                // Fallback
                                requestAnimationFrame(onFrame);
                            }
                        };
                        
                        // Timeout safety just in case
                        const timeout = setTimeout(resolve, 1500);
                        
                        if (video.requestVideoFrameCallback) {
                            video.requestVideoFrameCallback(onFrame);
                        } else {
                            setTimeout(onFrame, 100);
                        }
                    });
                    console.log(`[DEBUG-SCAN] Hardware wait resolved in ${performance.now() - hardwareWaitStart}ms.`);
                    
                    if (app.deviceCamera.texture) {
                        app.deviceCamera.texture.needsUpdate = true;
                    }
                }

                // Wait for 1 more frame just to ensure video size is propagated to DOM
                await new Promise(r => setTimeout(r, 50)); 
                console.log("[DEBUG-SCAN] deviceCamera hardware is successfully streaming.");
            }
        } else {
            const canvas = document.getElementById('process-canvas');
            await camera.captureFrame(canvas, false); 
        }

        // 2. Enable Scanning (Now safe)
        isScanning = true;
        
        // Update all visual lights to toggle draggability OFF
        virtualLights.forEach(vl => vl.updateVisuals());
        
        // Update UI
        if (hud && hud.setScanState) hud.setScanState(true);
        hud.speak("Scanning started. Please pan around.");
        hud.log("Scanning Active...", '#00FF00');

    } else {
        // --- STOPPING SCAN ---
        isScanning = false;
        
        // Anchor cleanup moved to STARTING SCAN so anchors persist for pairing
        
        // Update all visual lights to toggle draggability ON (if unpaired)
        virtualLights.forEach(vl => vl.updateVisuals());
        
        // Remove video from DOM to let hardware decoder sleep and save battery
        if (hud.mode !== '2D') {
            const app = xb.core;
            if (app && app.deviceCamera && app.deviceCamera.video && app.deviceCamera.video.parentNode) {
                app.deviceCamera.video.parentNode.removeChild(app.deviceCamera.video);
                console.log("[Scan] Removed video element from DOM to sleep decoder.");
            }
        }
        
        // We leave the keep-alive active permanently to prevent video freezing
        // Only logging scanning pause now.
        
        // 4. Update UI
        if (hud && hud.setScanState) hud.setScanState(false);
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
            d.id?.startsWith('light.') || 
            d.id?.startsWith('switch.') ||
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
        
        // Fetch current state and update immediately
        if (typeof smartHome !== 'undefined') {
            smartHome.getLightState(device.id).then(isOn => {
                if (isOn !== null) {
                    vl.isOn = isOn;
                    if (vl.updateVisuals) vl.updateVisuals();
                    if (typeof hud !== 'undefined' && hud.drawLights) hud.drawLights(virtualLights);
                }
            });
        }
        
        // Next
        configIndex++;
        // Small delay
        setTimeout(configureNextLight, 1000);
        
    }, (text) => hud.speak(text));
}

// Removed Voice Command and Speech Recognition logic completely per user request


// Updated spawnVirtualLights to use Historical Matrix
async function spawnVirtualLights(lights, cameraMatrix) {
    if (!lights) return;
    
    console.log("[Spawn] Update Virtual Lights", lights);

    // Check Mode
    const is3D = (hud.mode === '3D');

    const keptLights = [];
    const newCandidates = [];
    
    // Keep lights that are already linked (Paired), or being selected/moved by user
    for (const vl of virtualLights) {
        if (vl.linkedNodeId || vl.isSelectingDevice || vl.hasBeenMoved) {
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
    

            // Estimate depth based on bounding box size using true perspective inversion.
            // Typical smart home devices (switches, bulbs, lamps) average ~0.15m in physical scale.
            // Clamped to a comfortable, easily readable near-field MR range (0.75m - 1.45m) so panels
            // sit right next to physical objects instead of floating far away in physical space.
            const boxSize = Math.max(l.xmax - l.xmin, l.ymax - l.ymin);
            
            let z = -1.15; 
            if (boxSize > 0) {
                 const size = Math.max(0.05, boxSize);
                 z = -Math.max(0.75, Math.min(1.45, 0.15 / size)); 
            }
            
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

            let vH = 1.8; 
            let vW = 3.2; 
            
            if (cam && cam.isPerspectiveCamera) {
                vH = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * Math.abs(z);
                vW = vH * cam.aspect;
            }

            const x = (cx - 0.5) * vW; 
            const y = -(cy - 0.5) * vH; 
            
            // Create a 3D panel with base width 0.36m
            const vLight = new VirtualLight3D(l, label, 0.36, 0.5);
            
            // Keep uniform scale at full size or slightly larger for effortless readability (1.0 - 1.25)
            const targetVisibleWidth = Math.max(0.36, (l.xmax - l.xmin) * vW * 1.2);
            const uniformScale = Math.max(1.0, Math.min(1.25, targetVisibleWidth / 0.36));
            vLight.scale.setScalar(uniformScale);
            
            // POSITIONING: Use Historical Camera Matrix with true local-floor coordinates
            if (cameraMatrix) {
                 // The coordinates (x, y, z) are relative to the camera at time of capture
                 vLight.position.set(x, y, z);
                 
                 // Transform by camera pose at time of capture into world coordinates
                 vLight.applyMatrix4(cameraMatrix);
                 
                 // Make the panel face the user's current camera position
                 let currentCam = xb.camera;
                 try {
                     if (xb.renderer && xb.renderer.xr && xb.renderer.xr.isPresenting) {
                         currentCam = xb.renderer.xr.getCamera();
                     }
                 } catch (err) {}
                 if (currentCam) vLight.lookAt(currentCam.position);
                 
                 console.log(`[Spawn] Placed '${label}' via Historical Matrix at`, vLight.position);
                 vLight.updateMatrixWorld(true);
            } else if (cam) {
                 const camPos = new THREE.Vector3();
                 const camDir = new THREE.Vector3();
                 cam.getWorldPosition(camPos);
                 cam.getWorldDirection(camDir);
                 
                 const basePos = camPos.clone().add(camDir.multiplyScalar(Math.abs(z)));
                 basePos.y = Math.max(0.8, camPos.y + y);
                 
                 vLight.position.copy(basePos);
                 vLight.lookAt(camPos); 
                 
                 console.log(`[Spawn] Placed '${label}' via Fallback Math at`, vLight.position);
                 vLight.updateMatrixWorld(true);
            } else {
                 console.warn(`[Spawn] No Camera! Using Safe Center with Offset.`);
                 vLight.position.set(x, 1.4 + y, z); 
                 vLight.updateMatrixWorld(true);
            }
            
            // Check if this candidate overlaps an already paired light bulb (within 0.4m)
            const overlapsPaired = keptLights.some(kl => {
                return (kl.realDevice || kl.linkedNodeId) && kl.position && kl.position.distanceTo(vLight.position) < 0.4;
            });
            if (overlapsPaired) {
                console.log(`[Spawn] Skipping candidate '${label}' overlapping already paired device at`, vLight.position);
                continue;
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
     
     for (const vl of virtualLights) {
         let matchedDevice = null;

         if (vl.unpaired) {
             if (vl.realDevice) {
                 vl.realDevice = null;
                 if (vl.updateVisuals) vl.updateVisuals();
             }
             continue;
         }

         // A. Check Explicit Link (nodeId)
         if (vl.linkedNodeId) {
             matchedDevice = realDevices.find(d => d.id === vl.linkedNodeId || d.nodeId === vl.linkedNodeId);
         }
         
         // B. Check Label Match (Name-based) - only if explicit and not original label
         if (!matchedDevice && vl.labelText && vl.labelText !== vl.originalLabel) {
             matchedDevice = realDevices.find(d => d.name === vl.labelText || (d.traits && d.traits["sdm.devices.traits.Info"]?.customName === vl.labelText));
         }

         if (matchedDevice) {
              if (vl.realDevice !== matchedDevice) {
                  vl.realDevice = matchedDevice;
                  // If we didn't have ID, save it now
                  vl.linkedNodeId = matchedDevice.id; 
                  
                  const devName = matchedDevice.traits?.["sdm.devices.traits.Info"]?.customName || matchedDevice.name || "Device";
                  console.log(`[Link] Linked '${vl.labelText}' <-> Device: ${devName} (ID: ${matchedDevice.id})`);
                  hud.speak(`Linked to ${devName}`);
                  if (vl.mesh) vl.mesh.material.color.setHex(0x00FF00); // Green (Linked)
                  if (vl.updateVisuals) vl.updateVisuals();
              }
         } else {
              if (vl.realDevice) {
                   console.log(`[Link] Unlinked '${vl.labelText}'`);
                   vl.realDevice = null;
                   if (vl.mesh) vl.mesh.material.color.setHex(0xFFFF00); // Yellow (Unlinked)
                   if (vl.updateVisuals) vl.updateVisuals();
              }
          }

          // Poll State if linked (Throttle during scan?)
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
                     // For 3D panel update, we should call updateVisuals()
                     if (vl.updateVisuals) {
                          vl.updateVisuals();
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


// --- Global Helpers ---
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
            if (keypad.visible && keypad.panel && keypad.panel.mesh) {
                const keypadPos = new THREE.Vector3();
                keypad.panel.mesh.getWorldPosition(keypadPos);
                
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
        if (hud && hud.panel && hud.panel.update) {
            hud.panel.update();
        }
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
                         if (!keypad.panel) keypad.init(xb.scene);
                         
                         hud.speak("Enter Pairing Code.");
                         
                         // Position keypad centered in front of the camera
                         if (vl.mesh) {
                             const camPos = new THREE.Vector3();
                             const camDir = new THREE.Vector3();
                             let cam = xb.camera;
                             if (xb.renderer && xb.renderer.xr && xb.renderer.xr.isPresenting) {
                                 cam = xb.renderer.xr.getCamera();
                             }
                             cam.getWorldPosition(camPos);
                             cam.getWorldDirection(camDir);
                             
                             // Spawn exactly 5.0m in front of the user's view
                             const spawnPos = camPos.clone().add(camDir.multiplyScalar(5.0));
                             keypad.group.position.copy(spawnPos);
                             
                             // Face the user's headset perfectly
                             keypad.group.lookAt(camPos); 
                             keypad.group.rotateY(Math.PI); // Flipped so +Z faces camera natively.
                             keypad.group.updateMatrixWorld(true);
                             
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