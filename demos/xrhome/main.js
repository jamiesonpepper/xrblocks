/**
 * main.js
 * Entry point for XRHome.
 */

import { EasterEggManager } from './managers.js';

// XR Interaction Logic
// XR Interaction Logic
const raycaster = new THREE.Raycaster();
const tempMatrix = new THREE.Matrix4();
const _dummyLookObj = new THREE.Object3D();

// Drag State
let dragController = null;
let dragOffset = new THREE.Vector3();
let dragQuaternion = new THREE.Quaternion();

// Vision Buffers (Global for access by toggleScan)
let latestFrameBlob = null;
let latestCameraMatrix = null;

// Protect against upstream XRBlocks ScriptMixin calling non-existent super.dispose() on UIKit nodes
if (typeof xb !== 'undefined' && xb.Script && xb.Script.prototype) {
    const origDispose = xb.Script.prototype.dispose;
    xb.Script.prototype.dispose = function() {
        try {
            if (origDispose) origDispose.call(this);
        } catch (_) {}
    };
}

class HUDInteraction extends xb.Script {
    update(time, frame) {
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
            
            // Lock rotation to controller
            objectToMove.quaternion.copy(cQuat).multiply(dragQuaternion);
            
            // Force Panel Matrix World sync to ensure hitting raycasts align with visible location immediately
            if (objectToMove.updateMatrixWorld) objectToMove.updateMatrixWorld(true);
        }

        // --- Card Pivoting: UICards smoothly pivot to always face the camera/user ---
        let activeCam = null;
        try {
            if (xb.renderer && xb.renderer.xr && xb.renderer.xr.isPresenting) {
                activeCam = xb.renderer.xr.getCamera();
            } else if (xb.camera) {
                activeCam = xb.camera;
            } else if (typeof camera !== 'undefined' && camera) {
                activeCam = camera;
            }
        } catch (e) {}

        if (activeCam && virtualLights && virtualLights.length > 0) {
            const camPos = new THREE.Vector3();
            activeCam.getWorldPosition(camPos);

            for (const vl of virtualLights) {
                // If actively dragging this card, skip pivoting so the drag feels natural
                if (dragController && dragController.userData && (dragController.userData.selected === vl || dragController.userData.selected === vl.panel)) {
                    continue;
                }

                // Freeze orientation while selecting device in the tree menu
                if (vl.isSelectingDevice) {
                    continue;
                }

                // ONLY pivot after a device is paired! Initial UICards must remain stationary
                const isPaired = !!(vl.realDevice || vl.linkedNodeId);
                if (!isPaired) {
                    continue;
                }

                // Pivot to face camera horizontally (upright billboard)
                const cardWorldPos = new THREE.Vector3();
                vl.getWorldPosition(cardWorldPos);

                const targetPos = new THREE.Vector3(camPos.x, cardWorldPos.y, camPos.z);
                if (cardWorldPos.distanceToSquared(targetPos) > 0.005) {
                    _dummyLookObj.position.copy(cardWorldPos);
                    _dummyLookObj.lookAt(targetPos);
                    vl.quaternion.slerp(_dummyLookObj.quaternion, 0.1);
                }
            }
        }

        // --- Animated Depth Mesh Scanning Web --- (Disabled per user request)
        /*
        if (typeof scanningWeb !== 'undefined' && scanningWeb && scanningWeb.mesh && scanningWeb.mesh.visible && activeCam) {
            scanningWeb.update(activeCam);
        }
        */
    }

    onUpdate() {
        this.update();
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
            const isPaired = !!(vl.realDevice || vl.linkedNodeId);
            if (!isPaired && !vl.isSelectingDevice && vl.panel) {
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

        // 3. Virtual Light: Move the entire VirtualLight3D group directly so position is preserved!
        // Only allow dragging initial unpaired cards (never paired cards or device selection tree)
        if (virtualLights && virtualLights.length > 0) {
            for (const vl of virtualLights) {
                const isPaired = !!(vl.realDevice || vl.linkedNodeId);
                if (!isPaired && !vl.isSelectingDevice && vl.panel && (hit.object === vl.panel || isDescendant(hit.object, vl.panel))) {
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
        const selected = dragController.userData ? dragController.userData.selected : null;
        dragController = null;

        if (selected) {
            let targetVL = null;
            if (typeof VirtualLight3D !== 'undefined' && selected instanceof VirtualLight3D) {
                targetVL = selected;
            } else if (virtualLights) {
                targetVL = virtualLights.find(vl => vl.panel === selected || vl === selected);
            }

            if (targetVL && targetVL.realDevice && smartHome && smartHome.saveDeviceAnchor) {
                const dev = targetVL.realDevice;
                smartHome.saveDeviceAnchor({
                    id: dev.id,
                    entity_id: dev.id,
                    name: dev.name || dev.id,
                    area: dev.area || 'Other',
                    position: { x: targetVL.position.x, y: targetVL.position.y, z: targetVL.position.z },
                    quaternion: { x: targetVL.quaternion.x, y: targetVL.quaternion.y, z: targetVL.quaternion.z, w: targetVL.quaternion.w },
                    label: targetVL.label
                }).then(() => {
                    console.log(`[Persistence] Updated anchor after drag for ${dev.id}`);
                }).catch(e => console.warn("Save anchor after drag error:", e));
            }
        }
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

// Configure UI theme to use crisp white primary color for sliders & accents instead of default light blue
if (xb.ui && xb.ui.setTheme) {
    xb.ui.setTheme({
        colors: {
            primary: '#FFFFFF',
            outline: 'rgba(255, 255, 255, 0.30)',
        }
    });
}
import { AuthManager } from './auth.js';
import { CameraManager } from './webrtc.js';
import { VisionManager } from './vision.js?v=26';
import { FirebaseHAIntegration } from './services/firebase-ha-integration.js?v=56';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { HUDManager } from './hud.js?v=27';
import { VirtualKeypad } from './keypad.js?v=26';

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
hud.onResetPairings = async () => {
    hud.speak("Clearing all saved pairings...");
    hud.log("Clearing pairings...", '#FFFFFF');
    try {
        if (smartHome && smartHome.resetAllAnchors) {
            await smartHome.resetAllAnchors();
        }
        
        // Remove paired virtual lights from scene
        const remaining = [];
        for (const vl of virtualLights) {
            if (vl.realDevice || vl.linkedNodeId) {
                if (vl.parent) {
                    vl.parent.remove(vl);
                } else if (xb.scene) {
                    xb.scene.remove(vl);
                } else if (xb.remove) {
                    xb.remove(vl);
                }
            } else {
                remaining.push(vl);
            }
        }
        virtualLights = remaining;
        hud.speak("All pairings cleared.");
        hud.log("All pairings cleared.", '#FFFFFF');
    } catch (err) {
        console.error("Reset pairings error:", err);
        hud.log("Error clearing pairings", '#FF5555');
    }
};

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

function hexToHue(hex) {
    if (!hex || typeof hex !== 'string') return 0;
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (hex.length !== 6) return 0;
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    if (d === 0) return 0;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
    return h;
}

function toFahrenheit(val, unit) {
    if (val === undefined || val === null || val === 'unknown' || val === 'unavailable') return null;
    const num = Number(val);
    if (isNaN(num)) return null;
    const u = String(unit || '').toUpperCase();
    if (u.includes('F')) {
        return Math.round(num);
    }
    // Convert Celsius to Fahrenheit
    return Math.round((num * 9 / 5) + 32);
}

function formatCompletionTimestamp(isoString) {
    if (!isoString || isoString === 'unknown' || isoString === 'unavailable') return null;
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return null;
    
    let timeZone = undefined;
    try {
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
    } catch (_) {}

    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    
    const timePart = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone });
    if (isToday) {
        return `Today at ${timePart}`;
    } else {
        const datePart = d.toLocaleDateString([], { month: 'short', day: 'numeric', timeZone });
        return `${datePart}, ${timePart}`;
    }
}

function formatDishwasherRemainingTime(val, unit) {
    if (!val || val === 'unknown' || val === 'unavailable') return null;
    
    let totalSeconds = null;
    if (typeof val === 'string' && (val.includes('T') || val.includes('-'))) {
        const d = new Date(val);
        if (!isNaN(d.getTime())) {
            totalSeconds = Math.max(0, Math.floor((d.getTime() - Date.now()) / 1000));
        }
    }
    
    if (totalSeconds === null) {
        const num = Number(val);
        if (isNaN(num)) return String(val);
        
        if (unit === 's' || unit === 'seconds' || unit === 'sec') {
            totalSeconds = num;
        } else if (unit === 'min' || unit === 'minutes' || unit === 'm') {
            totalSeconds = num * 60;
        } else if (unit === 'h' || unit === 'hours') {
            totalSeconds = num * 3600;
        } else {
            totalSeconds = num > 300 ? num : num * 60;
        }
    }
    
    if (totalSeconds < 60) {
        return 'Less than a minute';
    }
    
    const totalMinutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    
    if (hours > 0) {
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    } else {
        return `${minutes}m`;
    }
}

// --- Animated Depth Mesh Scanning Web ---
class ScanningWebEffect {
    constructor() {
        // Wide-angle hemispherical dome covering the user's active camera space
        const geom = new THREE.SphereGeometry(3.5, 48, 36, 0, Math.PI * 2, 0, Math.PI * 0.7);
        
        const vertexShader = `
            varying vec3 vWorldPos;
            varying float vDist;
            void main() {
                vec4 wp = modelMatrix * vec4(position, 1.0);
                vWorldPos = wp.xyz;
                vDist = length(position);
                gl_Position = projectionMatrix * viewMatrix * wp;
            }
        `;

        const fragmentShader = `
            uniform float uTime;
            uniform float uOpacity;
            varying vec3 vWorldPos;
            varying float vDist;

            // Google Turbo Colormap polynomial (authentic multi-color rainbow)
            vec3 TurboColormap(in float x) {
                const vec4 kRedVec4 = vec4(0.55305649, 3.00913185, -5.46192616, -11.11819092);
                const vec4 kGreenVec4 = vec4(0.16207513, 0.17712472, 15.24091500, -36.50657960);
                const vec4 kBlueVec4 = vec4(-0.05195877, 5.18000081, -30.94853351, 81.96403246);
                const vec2 kRedVec2 = vec2(27.81927491, -14.87899417);
                const vec2 kGreenVec2 = vec2(25.95549545, -5.02738237);
                const vec2 kBlueVec2 = vec2(-86.53476570, 30.23299484);

                vec4 v4 = vec4(1.0, x, x * x, x * x * x);
                vec2 v2 = v4.zw * v4.z;
                return clamp(vec3(
                    dot(v4, kRedVec4)   + dot(v2, kRedVec2),
                    dot(v4, kGreenVec4) + dot(v2, kGreenVec2),
                    dot(v4, kBlueVec4)  + dot(v2, kBlueVec2)
                ), 0.0, 1.0);
            }

            void main() {
                // Outward traveling phasing wave across the scanning web
                float wavePhase = fract(vDist * 0.35 - uTime * 0.8);
                float wavePulse = smoothstep(0.0, 0.3, wavePhase) * smoothstep(1.0, 0.5, wavePhase);
                
                // Color shifts dynamically through Turbo Colormap spectrum
                float colorCoord = fract(wavePhase + uTime * 0.25 + vWorldPos.y * 0.15);
                vec3 col = TurboColormap(colorCoord);
                
                // Fine cybernetic grid ripple
                float ripple = 0.6 + 0.4 * sin(vDist * 14.0 - uTime * 6.0);
                vec3 finalColor = col * (1.3 * ripple + 0.5);

                gl_FragColor = vec4(finalColor, uOpacity * (0.4 + 0.6 * wavePulse));
            }
        `;

        this.uniforms = {
            uTime: { value: 0 },
            uOpacity: { value: 0.85 }
        };

        const mat = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader,
            fragmentShader,
            wireframe: true,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        this.mesh = new THREE.Mesh(geom, mat);
        this.mesh.visible = false;
        this.mesh.renderOrder = 999;
    }

    update(activeCam) {
        // Disabled per user request
        return;
    }

    show() {
        // Disabled per user request
        this.mesh.visible = false;
    }

    hide() {
        this.mesh.visible = false;
    }
}
const scanningWeb = new ScanningWebEffect();

// Category icon helper for smart appliances and devices
function getCategoryIcon(cat, domain) {
    const key = (domain || cat || '').toLowerCase();
    if (key.includes('lock')) return 'lock';
    if (key.includes('vacuum') || key.includes('roborock') || key.includes('roomba')) return 'cleaning_services';
    if (key.includes('dish')) return 'kitchen';
    if (key.includes('oven') || key.includes('stove') || key.includes('range')) return 'microwave';
    if (key.includes('washer') || key.includes('dryer') || key.includes('laundry')) return 'local_laundry_service';
    if (key.includes('climate') || key.includes('thermostat')) return 'thermostat';
    if (key.includes('media') || key.includes('tv')) return 'tv';
    if (key.includes('switch') || key.includes('plug')) return 'toggle_on';
    return 'lightbulb';
}

// --- 3D Virtual Device / Light (AR/XR) ---
class VirtualLight3D extends THREE.Group {
  constructor(geminiData, labelText, width = 0.36, height = 0.5) {
      super();
      this.geminiData = geminiData; // Keep for xmin/xmax/ymin/ymax
      this.category = (geminiData && geminiData.category) || 'light';
      this.originalLabel = labelText || (this.category ? `Smart ${this.category.charAt(0).toUpperCase() + this.category.slice(1)}` : "Device");
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
      this.hasCollapsedRecommended = false;
      this.hasBeenMoved = false;
      const cat = (this.category || '').toLowerCase();
      const isLightOrSwitch = !cat || cat.includes('light') || cat.includes('lamp') || cat.includes('switch') || cat === 'device';
      this.deviceFilterMode = isLightOrSwitch ? 'room' : 'recommended';

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
          this.remove(this.panel);
      }
      
      const isPaired = !!(this.realDevice || this.linkedNodeId);
      const canDrag = !isScanning && !isPaired && !this.isSelectingDevice;
      
      this.draggable = canDrag;
      this.draggingMode = 'TRANSLATING';
      this.dragFacingCamera = false;
      
      if (this.isSelectingDevice) {
          this._buildDeviceListUI();
          return;
      }
      
      const isOn = this.isOn;
      const stateColor = this.stateColor !== undefined ? this.stateColor : '#FFFFFF';
      
      const domain = (this.realDevice && this.realDevice.domain) ? this.realDevice.domain : (this.realDevice && this.realDevice.id ? this.realDevice.id.split('.')[0] : (this.category || 'light'));
      const cat = (this.category || domain || 'light').toLowerCase();
      const catIcon = getCategoryIcon(cat, domain);

      // Card Header: Category Icon + Device Label (always clean white)
      const labelText = new xb.UIText({
          text: this.labelText,
          style: {
              fontSize: 17,
              fontWeight: 'bold',
              color: '#FFFFFF',
              textAlign: 'center',
          }
      });

      const headerRow = new xb.UIPanel({
          style: {
              width: '100%',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
          },
          children: [
              new xb.UIIcon({
                  icon: catIcon,
                  style: { width: 20, height: 20, color: '#FFFFFF' }
              }),
              labelText
          ]
      });

      const cardChildren = [headerRow];

      // Reusable Unpair Button
      const makeUnpairBtn = () => new xb.UIButton({
          label: 'Unpair',
          icon: 'link_off',
          ariaLabel: 'Unpair device',
          userData: { interactive: true },
          style: {
              width: '100%',
              height: 36,
              borderRadius: 8,
              backgroundColor: 'rgba(255, 255, 255, 0.16)',
              borderWidth: 1,
              borderColor: '#FFFFFF',
              color: '#FFFFFF',
              ':hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.75)',
                  color: '#000000',
                  borderColor: '#FFFFFF',
              },
          },
          onClick: () => this.handleConfigClick()
      });

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
                  color: '#FFFFFF',
                  ':hover': {
                      backgroundColor: 'rgba(255, 255, 255, 0.75)',
                      color: '#000000',
                      borderColor: '#FFFFFF',
                  },
              },
              onClick: () => this.handleConfigClick()
          });
          cardChildren.push(btn);
      } else if (domain === 'lock' || cat === 'lock' || cat.includes('lock') || cat.includes('door')) {
          // --- DOOR LOCK UI ---
          const rawState = (this.realDevice?.state || '').toLowerCase();
          const isJammed = rawState === 'jammed';
          const isLocked = rawState === 'locked' || (rawState === '' && this.isOn);
          const statusText = isJammed ? '⚠️ JAMMED' : (isLocked ? '🔒 LOCKED' : '🔓 UNLOCKED');
          console.log(`[HA-DEBUG:rebuildPanel:LOCK] id=${this.realDevice?.id}, label=${this.labelText}, rawState='${rawState}', this.isOn=${this.isOn}, isLocked=${isLocked}, statusText='${statusText}'`);

          const statusRowChildren = [
              new xb.UIPanel({
                  style: {
                      padding: 8,
                      borderRadius: 8,
                      backgroundColor: 'rgba(255, 255, 255, 0.12)',
                      borderWidth: 1,
                      borderColor: 'rgba(255, 255, 255, 0.4)',
                      flexGrow: 1,
                      alignItems: 'center',
                      justifyContent: 'center',
                  },
                  children: [
                      new xb.UIText({ text: statusText, style: { fontSize: 13, fontWeight: 'bold', color: '#FFFFFF' } })
                  ]
              })
          ];

          if (this.realDevice?.battery !== null && this.realDevice?.battery !== undefined) {
              statusRowChildren.push(new xb.UIPanel({
                  style: {
                      padding: 6,
                      borderRadius: 8,
                      backgroundColor: 'rgba(255, 255, 255, 0.12)',
                      borderWidth: 1,
                      borderColor: 'rgba(255, 255, 255, 0.4)',
                  },
                  children: [
                      new xb.UIText({ text: `🔋 ${this.realDevice?.battery}%`, style: { fontSize: 13, color: '#FFFFFF' } })
                  ]
              }));
          }

          cardChildren.push(new xb.UIPanel({
              style: { width: '100%', flexDirection: 'row', gap: 6, alignItems: 'center' },
              children: statusRowChildren
          }));

          const lockActionBtn = new xb.UIButton({
              label: isLocked ? 'Unlock Door' : 'Lock Door',
              icon: isLocked ? 'lock_open' : 'lock',
              ariaLabel: isLocked ? 'Unlock Door' : 'Lock Door',
              userData: { interactive: true },
              style: {
                  width: '100%',
                  height: 42,
                  borderRadius: 10,
                  backgroundColor: isLocked ? 'rgba(255, 255, 255, 0.32)' : 'rgba(255, 255, 255, 0.16)',
                  borderWidth: 1.5,
                  borderColor: '#FFFFFF',
                  fontSize: 15,
                  fontWeight: 'bold',
                  color: '#FFFFFF',
                  ':hover': {
                      backgroundColor: 'rgba(255, 255, 255, 0.75)',
                      color: '#000000',
                      borderColor: '#FFFFFF',
                  },
              },
              onClick: () => this.toggleLock()
          });

          cardChildren.push(lockActionBtn);
          cardChildren.push(makeUnpairBtn());

      } else if (domain === 'vacuum' || cat === 'vacuum') {
          // --- ROBOT VACUUM & DOCK UI ---
          const vacState = (this.realDevice?.state || 'docked').toUpperCase();
          const isCleaning = (this.realDevice?.state === 'cleaning');
          const isDocked = (this.realDevice?.state === 'docked');

          const statusRow = new xb.UIPanel({
              style: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
              children: [
                  new xb.UIPanel({
                      style: {
                          padding: 6,
                          borderRadius: 8,
                          backgroundColor: 'rgba(255, 255, 255, 0.12)',
                          borderWidth: 1,
                          borderColor: 'rgba(255, 255, 255, 0.4)',
                      },
                      children: [
                          new xb.UIText({ text: `🌀 ${vacState}`, style: { fontSize: 12, fontWeight: 'bold', color: '#FFFFFF' } })
                      ]
                  }),
                  new xb.UIPanel({
                      style: {
                          padding: 6,
                          borderRadius: 8,
                          backgroundColor: 'rgba(255, 255, 255, 0.12)',
                          borderWidth: 1,
                          borderColor: 'rgba(255, 255, 255, 0.4)',
                      },
                      children: [
                          new xb.UIText({ text: `🔋 ${this.realDevice?.battery ?? 100}%`, style: { fontSize: 12, color: '#FFFFFF' } })
                      ]
                  })
              ]
          });
          cardChildren.push(statusRow);

          // Primary Controls: Start/Pause, Dock, Spot
          const startBtn = new xb.UIButton({
              ariaLabel: isCleaning ? 'Pause Vacuum' : 'Start Vacuum',
              userData: { interactive: true },
              style: {
                  flexGrow: 2,
                  height: 36,
                  borderRadius: 8,
                  backgroundColor: isCleaning ? 'rgba(255, 255, 255, 0.32)' : 'rgba(255, 255, 255, 0.14)',
                  borderWidth: 1,
                  borderColor: '#FFFFFF',
                  color: '#FFFFFF',
                  ':hover': {
                      backgroundColor: 'rgba(255, 255, 255, 0.75)',
                      color: '#000000',
                      borderColor: '#FFFFFF',
                  },
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6
              },
              children: [
                  new xb.UIIcon({ icon: isCleaning ? 'pause' : 'play_arrow', style: { width: 18, height: 18, color: '#FFFFFF' } }),
                  new xb.UIText({ text: isCleaning ? 'Pause' : 'Clean', style: { fontSize: 13, fontWeight: 'bold', color: '#FFFFFF' } })
              ],
              onClick: () => this.toggleVacuum()
          });

          const dockBtn = new xb.UIButton({
              ariaLabel: 'Dock Vacuum',
              userData: { interactive: true },
              style: {
                  flexGrow: 1,
                  height: 36,
                  borderRadius: 8,
                  backgroundColor: 'rgba(255, 255, 255, 0.14)',
                  borderWidth: 1,
                  borderColor: '#FFFFFF',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4
              },
              children: [
                  new xb.UIIcon({ icon: 'home', style: { width: 18, height: 18, color: '#FFFFFF' } }),
                  new xb.UIText({ text: 'Dock', style: { fontSize: 13, fontWeight: 'bold', color: '#FFFFFF' } })
              ],
              onClick: () => this.dockVacuum()
          });

          const spotBtn = new xb.UIButton({
              ariaLabel: 'Spot Clean Vacuum',
              userData: { interactive: true },
              style: {
                  flexGrow: 1,
                  height: 36,
                  borderRadius: 8,
                  backgroundColor: 'rgba(255, 255, 255, 0.14)',
                  borderWidth: 1,
                  borderColor: '#FFFFFF',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4
              },
              children: [
                  new xb.UIIcon({ icon: 'center_focus_strong', style: { width: 16, height: 16, color: '#FFFFFF' } }),
                  new xb.UIText({ text: 'Spot', style: { fontSize: 13, fontWeight: 'bold', color: '#FFFFFF' } })
              ],
              onClick: () => this.spotCleanVacuum()
          });

          cardChildren.push(new xb.UIPanel({
              style: { width: '100%', flexDirection: 'row', gap: 6 },
              children: [startBtn, dockBtn, spotBtn]
          }));

          // Dock Station Empty Dustbin Action - ONLY render if obtained from HA
          if (this.realDevice?.attributes && this.realDevice.attributes.dock_empty_entity) {
              const emptyDustbinBtn = new xb.UIButton({
                  ariaLabel: 'Empty Dustbin (Dock)',
                  userData: { interactive: true },
                  style: {
                      width: '100%',
                      height: 34,
                      borderRadius: 8,
                      backgroundColor: 'rgba(255, 255, 255, 0.15)',
                      borderWidth: 1,
                      borderColor: 'rgba(255, 255, 255, 0.6)',
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6
                  },
                  children: [
                      new xb.UIIcon({ icon: 'delete_sweep', style: { width: 18, height: 18, color: '#FFFFFF' } }),
                      new xb.UIText({ text: 'Empty Dustbin (Dock)', style: { fontSize: 13, fontWeight: 'bold', color: '#FFFFFF' } })
                  ],
                  onClick: () => this.emptyVacuumDock()
              });
              cardChildren.push(emptyDustbinBtn);
          }

          // Optional Dock Telemetry Alert Badges (only if reported by HA)
          const vacAlerts = [];
          if (this.realDevice?.attributes && this.realDevice.attributes.water_shortage) {
              vacAlerts.push(new xb.UIText({ text: '⚠️ Refill Water Tank', style: { fontSize: 12, color: '#FFFFFF', fontWeight: 'bold' } }));
          }
          if (this.realDevice?.attributes && this.realDevice.attributes.mop_attached) {
              vacAlerts.push(new xb.UIText({ text: '🧹 Mop Module Attached', style: { fontSize: 12, color: 'rgba(255, 255, 255, 0.8)' } }));
          }
          if (vacAlerts.length > 0) {
              cardChildren.push(new xb.UIPanel({
                  style: { width: '100%', padding: 6, backgroundColor: 'rgba(255, 255, 255, 0.08)', borderRadius: 6, gap: 2 },
                  children: vacAlerts
              }));
          }

          // Fan Speed Selection Row - ONLY render if fan_speed_list is obtained from HA
          const speeds = this.realDevice?.attributes?.fan_speed_list || ['quiet', 'balanced', 'turbo', 'max'];
          if (Array.isArray(speeds) && speeds.length > 0) {
              const currentSpeed = (this.realDevice?.fanSpeed || 'balanced').toLowerCase();
              const displaySpeeds = speeds.slice(0, 4); // Take up to 4 for clean fit
              const speedBtns = displaySpeeds.map(s => {
                  const sLabel = s.charAt(0).toUpperCase() + s.slice(1);
                  const isSelected = currentSpeed === s.toLowerCase();
                  return new xb.UIButton({
                      ariaLabel: `Fan speed ${sLabel}`,
                      userData: { interactive: true },
                      style: {
                          flexGrow: 1,
                          height: 26,
                          borderRadius: 6,
                          backgroundColor: isSelected ? 'rgba(255, 255, 255, 0.35)' : 'rgba(255, 255, 255, 0.1)',
                          borderWidth: isSelected ? 1.5 : 1,
                          borderColor: '#FFFFFF',
                          alignItems: 'center',
                          justifyContent: 'center'
                      },
                      children: [
                          new xb.UIText({ text: sLabel, style: { fontSize: 11, fontWeight: 'bold', color: '#FFFFFF' } })
                      ],
                      onClick: () => this.setVacuumFanSpeed(s)
                  });
              });

              cardChildren.push(new xb.UIPanel({
                  style: { width: '100%', flexDirection: 'row', gap: 4, alignItems: 'center' },
                  children: speedBtns
              }));
          }

          cardChildren.push(makeUnpairBtn());

      } else if (domain === 'dishwasher' || cat === 'dishwasher') {
          // --- UNIFIED DISHWASHER UI ---
          const attrs = this.realDevice?.attributes || {};
          const rawState = String(attrs.status || this.realDevice?.state || 'Ready').replace(/_/g, ' ').toUpperCase();
          const isRunning = rawState.includes('RUN') || rawState.includes('WASH') || rawState.includes('ON') || rawState.includes('ACTIVE');
          const statusColor = isRunning ? '#00FF88' : '#00DDFF';

          const statusBadge = new xb.UIPanel({
              style: {
                  width: '100%',
                  padding: 8,
                  borderRadius: 8,
                  backgroundColor: 'rgba(255, 255, 255, 0.12)',
                  borderWidth: 1,
                  borderColor: statusColor,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center'
              },
              children: [
                  new xb.UIText({ text: `🍽️ Status: ${rawState}`, style: { fontSize: 13, fontWeight: 'bold', color: statusColor } })
              ]
          });
          cardChildren.push(statusBadge);

          const dishTelemetry = [];

          // 1. Current Cycle - always render!
          const rawCycle = attrs.cycle || attrs.current_cycle || 
                           (this.realDevice?.related && this.realDevice.related.find(r => r.entity_id.includes('cycle'))?.state);
          const cycleDisplay = (rawCycle && rawCycle !== 'unknown' && rawCycle !== 'unavailable')
              ? String(rawCycle).replace(/_/g, ' ').toUpperCase()
              : 'NORMAL';
          dishTelemetry.push(new xb.UIText({ text: `🔄 Current Cycle: ${cycleDisplay}`, style: { fontSize: 13, color: '#FFFFFF', fontWeight: 'bold' } }));

          // 2. Remaining Time / Duration
          if (this._cycleChangedTimePending) {
              dishTelemetry.push(new xb.UIText({ text: `⏱️ Updating estimated time...`, style: { fontSize: 13, color: 'rgba(255, 255, 255, 0.7)' } }));
          } else {
              const timeVal = (attrs.remaining_time && attrs.remaining_time !== 'unknown' && attrs.remaining_time !== 'unavailable')
                  ? attrs.remaining_time
                  : (attrs.total_time && attrs.total_time !== 'unknown' && attrs.total_time !== 'unavailable' ? attrs.total_time : null);
              const timeUnit = (attrs.remaining_time && attrs.remaining_time !== 'unknown' && attrs.remaining_time !== 'unavailable')
                  ? attrs.remaining_time_unit
                  : attrs.total_time_unit;

              if (timeVal) {
                  const remText = formatDishwasherRemainingTime(timeVal, timeUnit);
                  if (remText) {
                      const isUnderMin = (remText === 'Less than a minute');
                      const isTotal = (!attrs.remaining_time || attrs.remaining_time === 'unknown' || attrs.remaining_time === 'unavailable');
                      const remLabel = isUnderMin ? `⏱️ Less than a minute` : (isTotal ? `⏱️ ~${remText} (estimated)` : `⏱️ ${remText} remaining`);
                      dishTelemetry.push(new xb.UIText({ text: remLabel, style: { fontSize: 13, color: '#00FF88', fontWeight: 'bold' } }));
                  }
              }
          }

          if (attrs.completion_time && attrs.completion_time !== 'unknown' && attrs.completion_time !== 'unavailable') {
              const compText = formatCompletionTimestamp(attrs.completion_time);
              if (compText) {
                  dishTelemetry.push(new xb.UIText({ text: `⏱️ Completed: ${compText}`, style: { fontSize: 13, color: '#FFFFFF' } }));
              }
          }

          if (attrs.door_open !== undefined) {
              const doorStr = attrs.door_open ? '⚠️ Door: Open' : '🚪 Door: Closed';
              const doorCol = attrs.door_open ? '#FFCC00' : '#FFFFFF';
              dishTelemetry.push(new xb.UIText({ text: doorStr, style: { fontSize: 13, color: doorCol } }));
          }

          if (attrs.rinse_refill_needed !== undefined) {
              const refillStr = attrs.rinse_refill_needed ? 'Yes' : 'No';
              const refillCol = attrs.rinse_refill_needed ? '#FFCC00' : '#FFFFFF';
              dishTelemetry.push(new xb.UIText({ text: `💧 Rinse Refill Needed: ${refillStr}`, style: { fontSize: 13, color: refillCol } }));
          }

          if (dishTelemetry.length > 0) {
              cardChildren.push(new xb.UIPanel({
                  style: { width: '100%', flexDirection: 'column', gap: 4, padding: 8, backgroundColor: 'rgba(255, 255, 255, 0.08)', borderRadius: 8 },
                  children: dishTelemetry
              }));
          }

          cardChildren.push(makeUnpairBtn());

      } else if (domain === 'oven' || cat === 'oven') {
          // --- UNIFIED OVEN UI ---
          const attrs = this.realDevice?.attributes || {};
          const rawState = String(attrs.operating_state || attrs.job_state || this.realDevice?.state || 'Ready').replace(/_/g, ' ').toUpperCase();
          const isHeating = rawState.includes('HEAT') || rawState.includes('RUN') || rawState.includes('BAKE') || rawState.includes('ON');

          const statusBadge = new xb.UIPanel({
              style: {
                  width: '100%',
                  padding: 8,
                  borderRadius: 8,
                  backgroundColor: 'rgba(255, 255, 255, 0.12)',
                  borderWidth: 1,
                  borderColor: 'rgba(255, 255, 255, 0.4)',
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center'
              },
              children: [
                  new xb.UIText({ text: `🍳 Status: ${rawState}`, style: { fontSize: 13, fontWeight: 'bold', color: '#FFFFFF' } })
              ]
          });
          cardChildren.push(statusBadge);

          // Dynamic Telemetry List - ONLY render fields obtained from HA
          const ovenTelemetry = [];

          if (attrs.setpoint !== undefined && attrs.setpoint !== null) {
              const setpointF = toFahrenheit(attrs.setpoint, attrs.setpoint_unit);
              if (setpointF !== null) {
                  ovenTelemetry.push(new xb.UIText({ text: `🎯 Set Point: ${setpointF}°F`, style: { fontSize: 13, fontWeight: 'bold', color: '#FFFFFF' } }));
              }
          }

          if (attrs.second_cavity_setpoint !== undefined && attrs.second_cavity_setpoint !== null) {
              const setpointF = toFahrenheit(attrs.second_cavity_setpoint, attrs.setpoint_unit);
              if (setpointF !== null) {
                  ovenTelemetry.push(new xb.UIText({ text: `🍳 Cavity 2 Set Point: ${setpointF}°F`, style: { fontSize: 13, color: '#FFFFFF' } }));
              }
          }

          if (attrs.mode && attrs.mode !== 'unknown' && attrs.mode !== 'others') {
              const modeStr = String(attrs.mode).replace(/_/g, ' ').toUpperCase();
              ovenTelemetry.push(new xb.UIText({ text: `♨️ Mode: ${modeStr}`, style: { fontSize: 13, color: '#FFFFFF' } }));
          }

          if (attrs.completion_time && attrs.completion_time !== 'unknown' && attrs.completion_time !== 'unavailable') {
              const compDate = new Date(attrs.completion_time);
              if (!isNaN(compDate.getTime())) {
                  const now = Date.now();
                  if (compDate.getTime() <= now || !isHeating) {
                      const compText = formatCompletionTimestamp(attrs.completion_time);
                      if (compText) {
                          ovenTelemetry.push(new xb.UIText({ text: `⏱️ Last Action Completed: ${compText}`, style: { fontSize: 13, color: '#FFFFFF' } }));
                      }
                  } else {
                      const remMs = compDate.getTime() - now;
                      const remMin = Math.floor(remMs / 60000);
                      const hours = Math.floor(remMin / 60);
                      const mins = remMin % 60;
                      let timeStr = '';
                      if (hours > 0) {
                          timeStr = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
                      } else if (remMin >= 1) {
                          timeStr = `${remMin}m`;
                      } else {
                          timeStr = 'Less than a minute';
                      }
                      ovenTelemetry.push(new xb.UIText({ text: `⏱️ Completes: In ${timeStr}`, style: { fontSize: 13, color: '#FFFFFF', fontWeight: 'bold' } }));
                  }
              }
          }

          if (attrs.door_open !== undefined) {
              const doorStr = attrs.door_open ? '⚠️ Door: Open' : '🚪 Door: Closed';
              ovenTelemetry.push(new xb.UIText({ text: doorStr, style: { fontSize: 13, color: '#FFFFFF' } }));
          }

          if (attrs.child_lock !== undefined) {
              const lockStr = attrs.child_lock ? '🔒 Child Lock: ON' : '🔓 Child Lock: OFF';
              ovenTelemetry.push(new xb.UIText({ text: lockStr, style: { fontSize: 13, color: '#FFFFFF' } }));
          }

          if (ovenTelemetry.length > 0) {
              cardChildren.push(new xb.UIPanel({
                  style: { width: '100%', flexDirection: 'column', gap: 4, padding: 8, backgroundColor: 'rgba(255, 255, 255, 0.08)', borderRadius: 8 },
                  children: ovenTelemetry
              }));
          }

          // Action Buttons: Stop Button and Lamp Toggle (ONLY render if available in HA)
          const ovenControls = [];

          if (attrs.stop_entity) {
              const stopBtn = new xb.UIButton({
                  ariaLabel: 'Stop Oven',
                  userData: { interactive: true },
                  style: {
                      flexGrow: 1,
                      height: 36,
                      borderRadius: 8,
                      backgroundColor: 'rgba(255, 255, 255, 0.16)',
                      borderWidth: 1,
                      borderColor: '#FFFFFF',
                      color: '#FFFFFF',
                      ':hover': {
                          backgroundColor: 'rgba(255, 255, 255, 0.75)',
                          color: '#000000',
                          borderColor: '#FFFFFF',
                      },
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6
                  },
                  children: [
                      new xb.UIIcon({ icon: 'stop', style: { width: 18, height: 18, color: '#FFFFFF' } }),
                      new xb.UIText({ text: 'Stop Oven', style: { fontSize: 13, fontWeight: 'bold', color: '#FFFFFF' } })
                  ],
                  onClick: () => this.stopOven()
              });
              ovenControls.push(stopBtn);
          }

          if (attrs.lamp_entity) {
              const lampStateStr = String(attrs.lamp_state || '').toLowerCase();
              const lampOn = lampStateStr === 'on' || lampStateStr.includes('on') || lampStateStr === 'true';
              const isLampControllable = (attrs.lamp_controllable !== false) &&
                                         !attrs.lamp_entity.startsWith('binary_sensor.') &&
                                         !attrs.lamp_entity.startsWith('sensor.') &&
                                         !this.lampControlFailed;

              if (isLampControllable) {
                  const lampBtn = new xb.UIButton({
                      ariaLabel: 'Oven Lamp',
                      userData: { interactive: true },
                      style: {
                          flexGrow: 1,
                          height: 36,
                          borderRadius: 8,
                          backgroundColor: lampOn ? 'rgba(255, 255, 255, 0.32)' : 'rgba(255, 255, 255, 0.14)',
                          borderWidth: 1,
                          borderColor: lampOn ? '#FFFFFF' : 'rgba(255, 255, 255, 0.5)',
                          color: '#FFFFFF',
                          ':hover': {
                              backgroundColor: 'rgba(255, 255, 255, 0.75)',
                              color: '#000000',
                              borderColor: '#FFFFFF',
                          },
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6
                      },
                      children: [
                          new xb.UIIcon({ icon: 'lightbulb', style: { width: 18, height: 18, color: '#FFFFFF' } }),
                          new xb.UIText({ text: lampOn ? 'Lamp ON' : 'Lamp OFF', style: { fontSize: 13, fontWeight: 'bold', color: '#FFFFFF' } })
                      ],
                      onClick: () => this.toggleOvenLamp()
                  });
                  ovenControls.push(lampBtn);
              } else {
                  // Non-interactive status badge
                  const lampBadge = new xb.UIPanel({
                      style: {
                          flexGrow: 1,
                          height: 36,
                          borderRadius: 8,
                          backgroundColor: lampOn ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                          borderWidth: 1,
                          borderColor: lampOn ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.2)',
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6
                      },
                      children: [
                          new xb.UIIcon({ icon: 'lightbulb', style: { width: 18, height: 18, color: lampOn ? '#FFFFFF' : 'rgba(255, 255, 255, 0.6)' } }),
                          new xb.UIText({ text: lampOn ? 'Lamp: ON' : 'Lamp: OFF', style: { fontSize: 13, fontWeight: 'bold', color: lampOn ? '#FFFFFF' : 'rgba(255, 255, 255, 0.6)' } })
                      ]
                  });
                  ovenControls.push(lampBadge);
              }
          }

          if (ovenControls.length > 0) {
              cardChildren.push(new xb.UIPanel({
                  style: { width: '100%', flexDirection: 'row', gap: 6 },
                  children: ovenControls
              }));
          }

          cardChildren.push(makeUnpairBtn());

      } else if (cat === 'appliance') {
          // --- GENERIC APPLIANCE FALLBACK ---
          const appState = String(this.realDevice?.state || 'Ready').toUpperCase();
          const isRunning = appState.includes('RUN') || appState.includes('ON');
          const statusColor = isRunning ? '#00FF88' : '#00DDFF';

          cardChildren.push(new xb.UIPanel({
              style: {
                  width: '100%',
                  padding: 8,
                  borderRadius: 8,
                  backgroundColor: 'rgba(255, 255, 255, 0.12)',
                  borderWidth: 1,
                  borderColor: statusColor,
                  alignItems: 'center',
                  justifyContent: 'center'
              },
              children: [
                  new xb.UIText({ text: `⚙️ Status: ${appState}`, style: { fontSize: 13, fontWeight: 'bold', color: statusColor } })
              ]
          }));

          cardChildren.push(makeUnpairBtn());

      } else if (domain === 'sensor') {
          // --- STANDALONE SENSOR / TELEMETRY CARD (e.g. Dishwasher run time left) ---
          const stateVal = String(this.realDevice?.state || 'Unknown');
          const unit = this.realDevice?.attributes?.unit_of_measurement || '';
          let displayVal = unit ? `${stateVal} ${unit}` : stateVal;
          
          // Nicely format duration/time if numeric
          const num = Number(stateVal);
          if (!isNaN(num) && (unit.includes('min') || unit.includes('s') || this.labelText.toLowerCase().includes('time') || this.labelText.toLowerCase().includes('remaining'))) {
              if (num > 60 && !unit.includes('h')) {
                  displayVal = `${Math.floor(num / 60)}h ${Math.round(num % 60)}m`;
              } else {
                  displayVal = `${Math.round(num)} ${unit || 'min'}`;
              }
          }

          cardChildren.push(new xb.UIPanel({
              style: {
                  width: '100%',
                  padding: 10,
                  borderRadius: 8,
                  backgroundColor: 'rgba(255, 255, 255, 0.12)',
                  borderWidth: 1,
                  borderColor: '#00DDFF',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4
              },
              children: [
                  new xb.UIText({ text: `⏱️ ${this.labelText}`, style: { fontSize: 12, color: 'rgba(255, 255, 255, 0.8)' } }),
                  new xb.UIText({ text: displayVal, style: { fontSize: 18, fontWeight: 'bold', color: '#00FF88' } })
              ]
          }));

          cardChildren.push(makeUnpairBtn());

      } else {
          // --- LIGHT OR GENERIC SWITCH UI ---
          // 1. Power Toggle & Unpair (Equal size buttons with clean icons and text)
          const toggleBtn = new xb.UIButton({
              label: isOn ? 'ON' : 'OFF',
              icon: 'power_settings_new',
              ariaLabel: isOn ? 'Turn Off' : 'Turn On',
              userData: { interactive: true },
              style: {
                  flexGrow: 1,
                  height: 36,
                  borderRadius: 8,
                  backgroundColor: isOn ? 'rgba(255, 255, 255, 0.32)' : 'rgba(255, 255, 255, 0.12)',
                  borderWidth: 1,
                  borderColor: isOn ? '#FFFFFF' : 'rgba(255, 255, 255, 0.5)',
                  color: '#FFFFFF',
                  ':hover': {
                      backgroundColor: 'rgba(255, 255, 255, 0.75)',
                      color: '#000000',
                      borderColor: '#FFFFFF',
                  },
              },
              onClick: () => this.toggle()
          });

          const unpairBtn = new xb.UIButton({
              label: 'Unpair',
              icon: 'link_off',
              ariaLabel: 'Unpair device',
              userData: { interactive: true },
              style: {
                  flexGrow: 1,
                  height: 36,
                  borderRadius: 8,
                  backgroundColor: 'rgba(255, 255, 255, 0.16)',
                  borderWidth: 1,
                  borderColor: '#FFFFFF',
                  color: '#FFFFFF',
                  ':hover': {
                      backgroundColor: 'rgba(255, 255, 255, 0.75)',
                      color: '#000000',
                      borderColor: '#FFFFFF',
                  },
              },
              onClick: () => this.handleConfigClick()
          });
          
          cardChildren.push(new xb.UIPanel({
              style: { width: '100%', flexDirection: 'row', gap: 6 },
              children: [toggleBtn, unpairBtn]
          }));
          
          // If light, include brightness, color, and temperature controls
          if (domain === 'light' || (this.realDevice && this.realDevice.attributes && this.realDevice.attributes.brightness !== undefined)) {
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
                  style: { width: '100%', height: 26, color: '#FFFFFF' },
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
                  width: 20,
                  height: 20,
                  cornerRadius: 10,
                  fillColor: this.stateColor || '#FFFFFF',
                  strokeWidth: 1.5,
                  strokeColor: '#FFFFFF',
                  style: {
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      backgroundColor: this.stateColor || '#FFFFFF',
                      borderWidth: 1.5,
                      borderColor: '#FFFFFF',
                  }
              });

              const updateColorIndicator = (hex) => {
                  if (!hex) return;
                  if (colorIndicator.setFillColor) colorIndicator.setFillColor(hex);
                  if (colorIndicator.setProperties) colorIndicator.setProperties({ fillColor: hex, backgroundColor: hex });
                  if (colorIndicator.style) colorIndicator.style.backgroundColor = hex;
                  if (colorIndicator.markUIDirty) colorIndicator.markUIDirty();
              };

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
                  style: { width: '100%', height: 26, color: '#FFFFFF' },
                  onInput: (val) => {
                      this.currentHue = Math.round(val);
                      const [r, g, b] = hslToRgb(this.currentHue);
                      const toHex = (n) => n.toString(16).padStart(2, '0');
                      this.stateColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
                      updateColorIndicator(this.stateColor);
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
                      marginTop: -2,
                      marginBottom: 2,
                  },
                  children: rainbowSegments
              });

              cardChildren.push(rainbowHeader);
              cardChildren.push(rainbowSlider);
              cardChildren.push(rainbowBar);

              // 4. 6 Common Temperatures
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
                      updateColorIndicator(preset.hex);
                  }
              }));

              cardChildren.push(tempText);
              cardChildren.push(new xb.UIPanel({
                  style: { width: '100%', flexDirection: 'row', gap: 4 },
                  children: tempButtons
              }));
          }
      }

      this.panel = new xb.UICard({
          size: { width: this.panelWidth, height: 'auto' },
          anchorX: 'center',
          anchorY: 'top',
          manipulation: canDrag,
          style: {
              flexDirection: 'column',
              gap: 8,
              padding: 12,
              backgroundColor: 'rgba(0, 0, 0, 0.20)',
              borderWidth: 1.5,
              borderColor: '#FFFFFF',
              borderRadius: 16,
          },
          children: cardChildren
      });

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
                    
                    if (smartHome && smartHome.deleteDeviceAnchor) {
                        smartHome.deleteDeviceAnchor(devId).catch(e => console.warn("Cloud anchor remove error:", e));
                    }
                    
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
            // Tree menu takes its exact positional and rotational reference from the UICard when Pair Device is clicked
            if (this.panel) {
                const worldPos = new THREE.Vector3();
                const worldQuat = new THREE.Quaternion();
                this.panel.getWorldPosition(worldPos);
                this.panel.getWorldQuaternion(worldQuat);
                if (this.parent) {
                    this.parent.worldToLocal(worldPos);
                }
                this.position.copy(worldPos);
                this.quaternion.copy(worldQuat);
                this.panel.position.set(0, 0, 0);
                this.panel.quaternion.identity();
            }
            this.isSelectingDevice = true;
            this.devicePage = 0;
            const cat = (this.category || '').toLowerCase();
            const isLightOrSwitch = !cat || cat.includes('light') || cat.includes('lamp') || cat.includes('switch') || cat === 'device';
            this.deviceFilterMode = isLightOrSwitch ? 'room' : 'recommended';
            this.rebuildPanel();
      }
  }

  _buildDeviceListUI() {
      const allDevices = Array.from(smartHome.devices.values());
      // Filter out helper buttons, selects, and binary sensors from the main pairing list
      // Also filter out any child components of compound appliances (e.g. oven/dishwasher individual sensors/buttons)
      const devices = allDevices.filter(d => {
          if (d.id.startsWith('button.') || d.id.startsWith('select.') || d.id.startsWith('binary_sensor.')) return false;
          const idLower = d.id.toLowerCase();
          if (idLower.includes('oven') && d.id !== 'appliance.oven') return false;
          if (idLower.includes('dishwasher') && d.id !== 'appliance.dishwasher') return false;
          return true;
      });
      
      const targetCat = (this.category || '').toLowerCase();
      const recommended = [];
      const areaGroups = {};

      devices.forEach(d => {
          const domain = d.domain || d.id.split('.')[0];
          const name = (d.name || d.id).toLowerCase();
          const isMatch = (targetCat && (
              domain.includes(targetCat) ||
              name.includes(targetCat) ||
              (targetCat === 'lock' && (domain === 'lock' || name.includes('lock') || name.includes('deadbolt'))) ||
              (targetCat === 'vacuum' && (domain === 'vacuum' || name.includes('vacuum') || name.includes('roborock') || name.includes('roomba') || name.includes('q8'))) ||
              (targetCat === 'dishwasher' && (domain === 'dishwasher' || name.includes('dishwasher') || name.includes('dish'))) ||
              (targetCat === 'oven' && (domain === 'oven' || name.includes('oven') || name.includes('stove') || name.includes('range') || name.includes('microwave'))) ||
              (targetCat === 'appliance' && (domain === 'appliance' || domain === 'dishwasher' || domain === 'oven' || name.includes('washer') || name.includes('dryer') || name.includes('fridge') || name.includes('refrigerator'))) ||
              (targetCat === 'light' && (domain === 'light' || name.includes('lamp') || name.includes('light'))) ||
              (targetCat === 'switch' && (domain === 'switch' || name.includes('plug') || name.includes('switch'))) ||
              (targetCat === 'climate' && (domain === 'climate' || name.includes('thermostat')))
          ));
          if (isMatch) {
              recommended.push(d);
          }
          const isAppliance = (domain === 'oven' || domain === 'dishwasher' || domain === 'vacuum' || domain === 'appliance' || d.id.startsWith('appliance.') || d.id.startsWith('vacuum.'));
          const isApplianceTarget = (targetCat === 'oven' || targetCat === 'dishwasher' || targetCat === 'vacuum' || targetCat === 'appliance');
          
          // In Room browsing mode, filter out appliances unless the target anchor is specifically an appliance
          if (!isAppliance || isApplianceTarget) {
              const area = d.area || 'Other';
              if (!areaGroups[area]) areaGroups[area] = [];
              areaGroups[area].push(d);
          }
      });

      // 2. Sort Areas Alphabetically Ascending (A -> Z)
      const sortedAreas = Object.keys(areaGroups).sort((a, b) => a.localeCompare(b));

      // 3. Sort Devices within each area Alphabetically Ascending (A -> Z)
      sortedAreas.forEach(area => {
          areaGroups[area].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
      });
      recommended.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

      if (!this.expandedAreas) this.expandedAreas = new Set();
      if (!this.deviceFilterMode) {
          const cat = (this.category || '').toLowerCase();
          const isLightOrSwitch = !cat || cat.includes('light') || cat.includes('lamp') || cat.includes('switch') || cat === 'device';
          this.deviceFilterMode = isLightOrSwitch ? 'room' : 'recommended';
      }
      const isRecMode = (this.deviceFilterMode === 'recommended');

      // 4. Build flattened list of visible tree nodes
      const visibleItems = [];

      // Add Recommended section at top only if filter mode is 'recommended' and matches found
      if (isRecMode && recommended.length > 0) {
          const recAreaName = `Recommended (${targetCat.toUpperCase()})`;
          const isRecExpanded = !this.hasCollapsedRecommended;
          visibleItems.push({
              type: 'area',
              area: recAreaName,
              count: recommended.length,
              isExpanded: isRecExpanded,
              isRecommended: true
          });
          if (isRecExpanded) {
              recommended.forEach(dev => {
                  visibleItems.push({
                      type: 'device',
                      device: dev,
                      area: recAreaName
                  });
              });
          }
      }

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
              new xb.UIText({ text: 'Select Device', style: { fontSize: 15, fontWeight: 'bold', color: '#FFFFFF' } }),
              new xb.UIPanel({
                  style: {
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6
                  },
                  children: [
                      new xb.UIButton({
                          label: isRecMode ? 'Recommended' : 'By Room',
                          ariaLabel: `Filter mode: ${isRecMode ? 'Recommended' : 'Room'}. Click to toggle.`,
                          userData: { interactive: true },
                          style: {
                              height: 28,
                              borderRadius: 6,
                              borderWidth: 1,
                              borderColor: '#FFFFFF',
                              backgroundColor: isRecMode ? '#FFFFFF' : 'rgba(255, 255, 255, 0.14)',
                              fontSize: 11,
                              fontWeight: 'bold',
                              color: isRecMode ? '#000000' : '#FFFFFF',
                              ':hover': {
                                  backgroundColor: 'rgba(255, 255, 255, 0.75)',
                                  color: '#000000',
                                  borderColor: '#FFFFFF',
                              },
                          },
                          onClick: () => {
                              this.deviceFilterMode = isRecMode ? 'room' : 'recommended';
                              this.devicePage = 0;
                              this.rebuildPanel();
                          }
                      }),
                      new xb.UIButton({
                          label: '✕',
                          ariaLabel: 'Cancel selection',
                          style: {
                              width: 28,
                              height: 28,
                              borderRadius: 6,
                              borderWidth: 1,
                              borderColor: '#FFFFFF',
                              backgroundColor: 'rgba(255, 255, 255, 0.12)',
                              color: '#FFFFFF',
                              ':hover': {
                                  backgroundColor: 'rgba(255, 255, 255, 0.75)',
                                  color: '#000000',
                                  borderColor: '#FFFFFF',
                              },
                          },
                          onClick: () => {
                              this.isSelectingDevice = false;
                              this.rebuildPanel();
                          }
                      })
                  ]
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
                      userData: { interactive: true },
                      style: {
                          width: '100%',
                          height: 34,
                          borderRadius: 8,
                          backgroundColor: item.isRecommended ? '#FFFFFF' : 'rgba(255, 255, 255, 0.18)',
                          borderWidth: 1,
                          borderColor: item.isRecommended ? '#FFFFFF' : 'rgba(255, 255, 255, 0.7)',
                          fontSize: 14,
                          fontWeight: 'bold',
                          color: item.isRecommended ? '#000000' : '#FFFFFF',
                          ':hover': {
                              backgroundColor: 'rgba(255, 255, 255, 0.75)',
                              color: '#000000',
                              borderColor: '#FFFFFF',
                          },
                      },
                      onClick: () => {
                          if (item.isRecommended) {
                              this.hasCollapsedRecommended = !this.hasCollapsedRecommended;
                              this.rebuildPanel();
                              return;
                          }
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
                  const devDomain = dev.domain || dev.id.split('.')[0];
                  const icon = getCategoryIcon(devDomain, devDomain);
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
                          ':hover': {
                              backgroundColor: 'rgba(255, 255, 255, 0.75)',
                              color: '#000000',
                              borderColor: '#FFFFFF',
                          },
                      },
                      onClick: () => this.pairWithDevice(dev.id)
                  }));
              }
          });
          
          if (totalPages > 1) {
              const prevBtn = new xb.UIButton({
                  label: '<',
                  ariaLabel: 'Previous page',
                  disabled: this.devicePage <= 0,
                  style: {
                      width: 40,
                      height: 30,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: 'rgba(255, 255, 255, 0.4)',
                      backgroundColor: 'rgba(255, 255, 255, 0.12)',
                      color: '#FFFFFF',
                      ':hover': {
                          backgroundColor: 'rgba(255, 255, 255, 0.75)',
                          color: '#000000',
                          borderColor: '#FFFFFF',
                      },
                  },
                  onClick: () => { if (this.devicePage > 0) { this.devicePage--; this.rebuildPanel(); } }
              });
              const pageIndicator = new xb.UIText({
                  text: `${this.devicePage + 1} / ${totalPages}`,
                  style: { fontSize: 13, color: '#FFFFFF', textAlign: 'center', flexGrow: 1 }
              });
              const nextBtn = new xb.UIButton({
                  label: '>',
                  ariaLabel: 'Next page',
                  disabled: this.devicePage >= totalPages - 1,
                  style: {
                      width: 40,
                      height: 30,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: 'rgba(255, 255, 255, 0.4)',
                      backgroundColor: 'rgba(255, 255, 255, 0.12)',
                      color: '#FFFFFF',
                      ':hover': {
                          backgroundColor: 'rgba(255, 255, 255, 0.75)',
                          color: '#000000',
                          borderColor: '#FFFFFF',
                      },
                  },
                  onClick: () => { if (this.devicePage < totalPages - 1) { this.devicePage++; this.rebuildPanel(); } }
              });
              bodyChildren.push(new xb.UIPanel({
                  style: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
                  children: [prevBtn, pageIndicator, nextBtn]
              }));
          }
      }

      this.panel = new xb.UICard({
          size: { width: this.panelWidth, height: 'auto' },
          anchorX: 'center',
          anchorY: 'top',
          manipulation: false,
          style: {
              flexDirection: 'column',
              gap: 8,
              padding: 12,
              backgroundColor: 'rgba(0, 0, 0, 0.20)',
              borderWidth: 1.5,
              borderColor: '#FFFFFF',
              borderRadius: 16,
          },
          children: bodyChildren
      });

      this.panel.position.set(0, 0, 0);
      this.add(this.panel);
  }

  async pairWithDevice(deviceId) {
      hud.speak("Pairing device...");
      hud.log(`Pairing to ${deviceId}...`, '#FFFFFF');
      console.log(`[HA-DEBUG:PAIR:START] Initiating pairing for deviceId: ${deviceId}`);

      // Query live state from HA on pairing BEFORE rendering the card
      if (smartHome && smartHome.fetchLiveStates) {
          console.log(`[HA-DEBUG:PAIR:FETCH] Querying live state for ${deviceId}...`);
          try {
              await smartHome.fetchLiveStates(deviceId);
          } catch (e) {
              console.warn(`[HA-DEBUG:PAIR:FETCH-ERR] Failed to fetch live state:`, e);
          }
      }

      const device = smartHome.devices.get(deviceId);
      console.log(`[HA-DEBUG:PAIR:DEVICE-LOADED]`, deviceId, device ? { id: device.id, domain: device.domain, state: device.state, isOn: device.isOn, attributes: device.attributes } : "NOT FOUND IN MAP!");

      if (device) {
          this.unpaired = false;
          this.linkedNodeId = deviceId;
          this.realDevice = device;
          this.labelText = device.name || deviceId;
          this.label = this.labelText;
          this.isSelectingDevice = false;
          
          if (smartHome && smartHome.saveDeviceAnchor) {
              const pos = this.position;
              const quat = this.quaternion;
              smartHome.saveDeviceAnchor({
                  id: deviceId,
                  entity_id: deviceId,
                  name: device.name || deviceId,
                  area: device.area || 'Other',
                  position: { x: pos.x, y: pos.y, z: pos.z },
                  quaternion: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
                  label: this.label,
                  category: this.category || device.domain || 'light'
              }).then(saved => {
                  if (saved) hud.log(`Saved coordinates: ${deviceId}`, '#FFFFFF');
              }).catch(err => {
                  console.warn("Failed to save anchor", err);
              });
          }
          
          console.log(`[HA-DEBUG:PAIR:RENDER] Rendering UICard with realDevice.state='${this.realDevice.state}', isOn=${this.realDevice.isOn}`);
          this.updateVisuals();
          refreshRealDevices();
      }
  }

  updateVisuals() {
      const isPaired = !!(this.realDevice || this.linkedNodeId);
      const domain = (this.realDevice && this.realDevice.domain) ? this.realDevice.domain : (this.realDevice && this.realDevice.id ? this.realDevice.id.split('.')[0] : (this.category || 'light'));
      const isLock = (domain === 'lock' || this.category === 'lock' || (this.realDevice && this.realDevice.id && this.realDevice.id.startsWith('lock.')));
      const isOn = this.isOn;
      
      // Hydrate state from realDevice if available BEFORE rebuilding buttons
      if (this.realDevice) {
          this.isOn = this.realDevice.isOn;
          if (isLock) {
              console.log(`[HA-DEBUG:updateVisuals:LOCK] id=${this.realDevice.id}, label='${this.labelText}', realDevice.state='${this.realDevice.state}', realDevice.isOn=${this.realDevice.isOn}, hydrated this.isOn=${this.isOn}`);
          }
          if (this.realDevice.brightness !== undefined) {
              this.brightness = this.realDevice.brightness;
          }
          if (domain === 'light' || this.category === 'light') {
              if (this.realDevice.attributes?.rgb_color && Array.isArray(this.realDevice.attributes.rgb_color)) {
                  const [r, g, b] = this.realDevice.attributes.rgb_color;
                  const toHex = (n) => n.toString(16).padStart(2, '0');
                  this.stateColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
                  this.currentHue = hexToHue(this.stateColor);
              } else if (this.realDevice.attributes?.hs_color && Array.isArray(this.realDevice.attributes.hs_color)) {
                  this.currentHue = Math.round(this.realDevice.attributes.hs_color[0]);
                  const [r, g, b] = hslToRgb(this.currentHue, (this.realDevice.attributes.hs_color[1] ?? 100) / 100);
                  const toHex = (n) => n.toString(16).padStart(2, '0');
                  this.stateColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
              } else if (this.realDevice.color_temp_kelvin || this.realDevice.attributes?.color_temp_kelvin) {
                  this.colorTemp = this.realDevice.color_temp_kelvin || this.realDevice.attributes.color_temp_kelvin;
                  this.stateColor = kelvinToHex(this.colorTemp);
                  this.currentHue = hexToHue(this.stateColor);
              }
          }
      }

      let colorStr = '#FFFFFF';
      if (isPaired) {
          if (domain === 'dishwasher') {
              const dState = String(this.realDevice?.attributes?.status || this.realDevice?.state || '').toLowerCase();
              const isWash = dState.includes('run') || dState.includes('wash') || dState.includes('active');
              colorStr = isWash ? '#00FF88' : '#00DDFF';
          } else if (domain === 'light' || this.category === 'light') {
              if (!this.stateColor) {
                  this.stateColor = this.colorTemp ? kelvinToHex(this.colorTemp) : '#FFFFFF';
              }
              colorStr = this.stateColor;
          } else {
              colorStr = isOn ? '#FFFFFF' : 'rgba(255, 255, 255, 0.55)';
          }
      }
      
      this.stateColor = colorStr;
      
      // Rebuild Panel to update Text/Icon/Sliders
      this.rebuildPanel();
  }

  toggle() {
      const domain = (this.realDevice && this.realDevice.domain) ? this.realDevice.domain : (this.realDevice && this.realDevice.id ? this.realDevice.id.split('.')[0] : (this.category || 'light'));
      if (domain === 'lock') {
          this.toggleLock();
          return;
      }
      if (domain === 'vacuum') {
          this.toggleVacuum();
          return;
      }

      const nextOn = !this.isOn;
      this.isOn = nextOn;
      if (this.realDevice) {
          this.realDevice.isOn = nextOn;
      }
      this.updateVisuals();
      
      if (this.realDevice && smartHome) {
          console.log(`[Toggle] 3D Device ${this.labelText} -> ${nextOn}`);
          
          const stateStr = nextOn ? "ON" : "OFF";
          const colorStr = nextOn ? '#FFFFFF' : 'rgba(255, 255, 255, 0.55)';
          hud.log(`${this.labelText} turned ${stateStr}`, colorStr);
          
          const togglePromise = (domain === 'switch') ? smartHome.toggleSwitch(this.realDevice.id, nextOn) : smartHome.toggleLight(this.realDevice.id, nextOn);
          togglePromise.then((success) => {
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

  toggleLock() {
      if (!this.realDevice || !smartHome) return;
      const lockState = (this.realDevice.state || '').toLowerCase();
      const isLocked = (lockState === 'locked' || (lockState === '' && this.isOn));
      const nextAction = isLocked ? 'unlock' : 'lock';
      console.log(`[HA-DEBUG:toggleLock:CLICK] deviceId=${this.realDevice.id}, currentRawState='${this.realDevice.state}', this.isOn=${this.isOn}, isLocked=${isLocked} -> executing nextAction='${nextAction}'`);
      hud.speak(isLocked ? "Unlocking Door" : "Locking Door");
      smartHome.controlLock(this.realDevice.id, nextAction).then(success => {
          console.log(`[HA-DEBUG:toggleLock:RESPONSE] success=${success}, nextAction='${nextAction}'`);
          if (success !== false) {
              this.realDevice.state = nextAction === 'lock' ? 'locked' : 'unlocked';
              this.realDevice.isOn = (nextAction === 'lock');
              this.isOn = (nextAction === 'lock');
              this._pendingLockAction = { state: this.realDevice.state, expiresAt: Date.now() + 5000 };
              console.log(`[HA-DEBUG:toggleLock:APPLIED] Local state set: state='${this.realDevice.state}', isOn=${this.isOn}`);
              this.updateVisuals();
              hud.log(`${this.labelText} ${nextAction}ed`, nextAction === 'lock' ? '#00FF88' : '#FF5555');
          } else {
              console.error(`[HA-DEBUG:toggleLock:FAIL] controlLock returned false for ${this.realDevice.id}`);
              hud.log(`Failed to ${nextAction} ${this.labelText}`, '#FF0000');
          }
      }).catch(err => console.error("[HA-DEBUG:toggleLock:ERR]", err));
  }

  toggleVacuum() {
      if (!this.realDevice || !smartHome) return;
      const isCleaning = (this.realDevice.state === 'cleaning');
      const nextAction = isCleaning ? 'pause' : 'start';
      hud.speak(isCleaning ? "Pausing Vacuum" : "Starting Vacuum");
      smartHome.controlVacuum(this.realDevice.id, nextAction).then(success => {
          if (success !== false) {
              this.realDevice.state = isCleaning ? 'paused' : 'cleaning';
              this.realDevice.isOn = !isCleaning;
              this.isOn = !isCleaning;
              this.updateVisuals();
              hud.log(`Vacuum ${nextAction === 'start' ? 'started' : 'paused'}`, '#00DDFF');
          } else {
              hud.log(`Failed to ${nextAction} Vacuum`, '#FF0000');
          }
      }).catch(err => console.error(err));
  }

  dockVacuum() {
      if (!this.realDevice || !smartHome) return;
      hud.speak("Returning Vacuum to Dock");
      smartHome.controlVacuum(this.realDevice.id, 'return_to_base').then(success => {
          if (success !== false) {
              this.realDevice.state = 'returning';
              this.updateVisuals();
              hud.log("Vacuum returning to dock", '#00DDFF');
          }
      }).catch(err => console.warn("Vacuum dock error:", err));
  }

  spotCleanVacuum() {
      if (!this.realDevice || !smartHome) return;
      hud.speak("Spot Cleaning");
      smartHome.controlVacuum(this.realDevice.id, 'clean_spot').then(success => {
          if (success !== false) {
              this.realDevice.state = 'cleaning';
              this.updateVisuals();
              hud.log("Vacuum spot cleaning", '#00FF88');
          }
      }).catch(err => console.warn("Vacuum spot clean error:", err));
  }

  emptyVacuumDock() {
      if (!this.realDevice || !smartHome) return;
      hud.speak("Emptying Dustbin");
      smartHome.triggerVacuumDockEmpty(this.realDevice.id).then(() => {
          hud.log("Dock Auto-Empty Triggered", '#00FF88');
      }).catch(err => console.warn("Dock empty error:", err));
  }

  setVacuumFanSpeed(speed) {
      if (!this.realDevice || !smartHome) return;
      hud.speak(`Suction: ${speed}`);
      smartHome.setVacuumFanSpeed(this.realDevice.id, speed.toLowerCase()).then(success => {
          if (success !== false) {
              this.realDevice.fanSpeed = speed.toLowerCase();
              this.updateVisuals();
              hud.log(`Vacuum suction set to ${speed}`, '#FFFFFF');
          }
      }).catch(err => console.warn("Vacuum fan speed error:", err));
  }

  stopOven() {
      if (!this.realDevice || !smartHome) return;
      hud.speak("Stopping Oven");
      smartHome.stopAppliance(this.realDevice.id).then(() => {
          hud.log("Oven Stop Triggered", '#FF5555');
          this.realDevice.state = 'off';
          if (this.realDevice.attributes) {
              this.realDevice.attributes.operating_state = 'off';
              this.realDevice.attributes.status = 'off';
          }
          this.updateVisuals();
      }).catch(err => console.warn("Oven stop error:", err));
  }

  toggleOvenLamp() {
      if (!this.realDevice || !smartHome) return;
      const currentLamp = this.realDevice.attributes?.lamp_state || 'off';
      const nextLamp = (currentLamp === 'on' || currentLamp === 'lamp_on') ? 'off' : 'on';
      hud.speak(`Oven Lamp ${nextLamp}`);
      const lampEnt = this.realDevice.attributes?.lamp_entity || null;
      smartHome.toggleOvenLamp(this.realDevice.id, nextLamp, lampEnt).then((res) => {
          if (res === false) {
              this.lampControlFailed = true;
              if (this.realDevice.attributes) {
                  this.realDevice.attributes.lamp_controllable = false;
              }
              this.updateVisuals();
              hud.log('Oven lamp is read-only', '#FFAA00');
              return;
          }
          if (this.realDevice.attributes) this.realDevice.attributes.lamp_state = nextLamp;
          this.updateVisuals();
          hud.log(`Oven Lamp ${nextLamp.toUpperCase()}`, '#FFFFFF');
      }).catch(err => {
          console.warn("Oven lamp error:", err);
          this.lampControlFailed = true;
          if (this.realDevice.attributes) {
              this.realDevice.attributes.lamp_controllable = false;
          }
          this.updateVisuals();
          hud.log('Oven lamp is read-only', '#FFAA00');
      });
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
          const prevHue = this.currentHue;
          const toHex = (n) => {
              const hex = n.toString(16);
              return hex.length === 1 ? '0' + hex : hex;
          };
          this.stateColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
          this.currentHue = hexToHue(this.stateColor);
          if (this.realDevice.attributes) {
              this.realDevice.attributes.rgb_color = [r, g, b];
              delete this.realDevice.attributes.color_temp_kelvin;
          }
          this.realDevice.color_temp_kelvin = undefined;

          // Note: Do NOT call this.rebuildPanel() here!
          // Rebuilding the card while the slider interaction ends cancels capture and resets value to 0 (red).
          smartHome.setColor(this.realDevice.id, r, g, b).then((success) => {
              if (success === false) {
                  this.stateColor = prevColor;
                  this.currentHue = prevHue;
                  this.rebuildPanel();
                  hud.log(`Failed to set color for ${this.labelText}`, '#FF0000');
              }
          }).catch(() => {
              this.stateColor = prevColor;
              this.currentHue = prevHue;
              this.rebuildPanel();
          });
      }
  }

  setColorTemp(kelvin, hexColor) {
      this.colorTemp = Math.round(kelvin);
      this.stateColor = hexColor || kelvinToHex(this.colorTemp);
      this.currentHue = hexToHue(this.stateColor);
      if (this.realDevice && this.realDevice.attributes) {
          this.realDevice.attributes.color_temp_kelvin = this.colorTemp;
          delete this.realDevice.attributes.rgb_color;
          delete this.realDevice.attributes.hs_color;
      }
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

const VirtualDevice3D = VirtualLight3D;


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
        await smartHome.listen(apiConfig.haUrl, apiConfig.haToken);
        console.log(`Home Assistant Connected! Successfully retrieved ${smartHome.devices.size} devices.`);
        
        // Listen for device changes
        smartHome.onDevicesChanged = (devices) => {
            console.log("Devices updated via HA:", devices);
            refreshRealDevices();
        };

        // Real-time Push State & Telemetry Updates via WebSocket
        smartHome.onEntityStateChanged = (entityId, newState, dev) => {
            virtualLights.forEach(vl => {
                if (!vl.realDevice) return;
                const isDirectMatch = (vl.realDevice.id === entityId || vl.linkedNodeId === entityId);
                const isRelatedMatch = (dev && vl.realDevice.id === dev.id) ||
                                       (vl.realDevice.attributes?.lamp_entity === entityId) ||
                                       (vl.realDevice.related && vl.realDevice.related.some(r => r.entity_id === entityId));

                if (isDirectMatch || isRelatedMatch) {
                    const isApplianceCard = (vl.realDevice.id.startsWith('appliance.') || vl.realDevice.domain === 'oven' || vl.realDevice.domain === 'dishwasher');
                    const isLock = (vl.realDevice.domain === 'lock' || vl.category === 'lock' || vl.realDevice.id.startsWith('lock.'));

                    if (isLock) {
                        console.log(`[HA-DEBUG:onEntityStateChanged:LOCK] entityId=${entityId}, isDirectMatch=${isDirectMatch}, isRelatedMatch=${isRelatedMatch}, incomingState='${newState?.state}', currentVlState='${vl.realDevice?.state}', currentVlIsOn=${vl.isOn}`);
                    }

                    if (isDirectMatch) {
                        // Direct match with primary device
                        if (dev && (dev.id === vl.realDevice.id || dev.id === vl.linkedNodeId)) {
                            vl.realDevice = dev;
                            if (!isLock) {
                                vl.isOn = dev.isOn;
                            }
                            if (dev.brightness !== undefined) vl.brightness = dev.brightness;
                        } else if (dev && dev.id !== vl.realDevice.id) {
                            console.warn(`[HA-DEBUG:PREVENT-OVERWRITE] Blocked attempt to overwrite ${vl.realDevice.id} with mismatched device ${dev.id}`);
                        }
                        if (newState) {
                            if (isLock) {
                                const s = (newState.state || '').toLowerCase();
                                console.log(`[HA-DEBUG:onEntityStateChanged:LOCK-DIRECT] Lock ${vl.realDevice.id} received state='${newState.state}' -> parsed='${s}'`);
                                const isGraceActive = vl._pendingLockAction && (Date.now() < vl._pendingLockAction.expiresAt);
                                if (isGraceActive && s !== vl._pendingLockAction.state) {
                                    console.warn(`[HA-DEBUG:onEntityStateChanged:LOCK-IGNORED] Ignored state '${newState.state}' for ${vl.realDevice.id} during command grace window for '${vl._pendingLockAction.state}'`);
                                } else if (['locked', 'unlocked', 'jammed'].includes(s)) {
                                    vl.realDevice.state = s;
                                    vl.realDevice.isOn = (s === 'locked');
                                    vl.isOn = (s === 'locked');
                                    if (vl._pendingLockAction && s === vl._pendingLockAction.state) {
                                        vl._pendingLockAction = null;
                                    }
                                    console.log(`[HA-DEBUG:onEntityStateChanged:LOCK-DIRECT-APPLIED] Set vl.realDevice.state='${vl.realDevice.state}', vl.isOn=${vl.isOn}`);
                                } else {
                                    console.warn(`[HA-DEBUG:onEntityStateChanged:LOCK-DIRECT-IGNORED] Ignored non-terminal state '${newState.state}' for ${vl.realDevice.id}`);
                                }
                            } else {
                                vl.realDevice.state = newState.state;
                                vl.isOn = ['on', 'cleaning', 'locked', 'running', 'lamp_on'].includes(newState.state);
                            }
                            vl.realDevice.attributes = { ...vl.realDevice.attributes, ...newState.attributes };
                        }
                    } else if (isRelatedMatch) {
                        if (isLock) {
                            console.log(`[HA-DEBUG:onEntityStateChanged:LOCK-RELATED] Secondary entity ${entityId} changed to '${newState?.state}', preserving primary lock state='${vl.realDevice.state}'`);
                        }
                        // Secondary / subordinate entity (e.g. battery sensor, contact sensor) changed
                        // NEVER overwrite vl.realDevice or its primary state with the secondary entity!
                        if (vl.realDevice.related) {
                            const relItem = vl.realDevice.related.find(r => r.entity_id === entityId);
                            if (relItem && newState) {
                                relItem.state = newState.state;
                                relItem.attributes = { ...relItem.attributes, ...newState.attributes };
                            }
                        }
                        if (newState?.attributes?.battery_level !== undefined) {
                            vl.realDevice.battery = newState.attributes.battery_level;
                        } else if (newState?.attributes?.battery !== undefined) {
                            vl.realDevice.battery = newState.attributes.battery;
                        } else if (entityId.includes('battery') && !isNaN(parseFloat(newState?.state))) {
                            vl.realDevice.battery = parseFloat(newState.state);
                        }
                        if (entityId.includes('door') || entityId.includes('contact')) {
                            if (!vl.realDevice.attributes) vl.realDevice.attributes = {};
                            vl.realDevice.attributes.door_open = (newState.state === 'on' || newState.state === 'open');
                        }

                        // Appliance specific sub-entity handling
                        if (isApplianceCard && newState) {
                            if (entityId.includes('operating_state') || entityId.includes('job_state') || entityId.includes('current_status') || entityId.includes('operation_state')) {
                                vl.realDevice.state = newState.state;
                                vl.realDevice.attributes.operating_state = newState.state;
                                vl.realDevice.attributes.status = newState.state;
                            }
                            if (entityId.includes('setpoint') || entityId.includes('target_temperature')) {
                                vl.realDevice.attributes.setpoint = parseFloat(newState.state);
                                if (newState.attributes?.unit_of_measurement) {
                                    vl.realDevice.attributes.setpoint_unit = newState.attributes.unit_of_measurement;
                                }
                            }
                            if (entityId.includes('second_cavity_setpoint')) {
                                vl.realDevice.attributes.second_cavity_setpoint = parseFloat(newState.state);
                                if (newState.attributes?.unit_of_measurement) {
                                    vl.realDevice.attributes.second_cavity_setpoint_unit = newState.attributes.unit_of_measurement;
                                }
                            }
                            if (entityId.includes('lamp') || entityId.includes('light') || vl.realDevice.attributes?.lamp_entity === entityId) {
                                vl.realDevice.attributes.lamp_state = newState.state;
                                console.log(`[HA-DEBUG:OVEN:LAMP-UPDATE] Updated oven lamp_state to '${newState.state}'`);
                            }
                            if (entityId.includes('completion_time') || entityId.includes('end_time') || entityId.includes('completion')) {
                                vl.realDevice.attributes.completion_time = newState.state;
                            }
                            if (entityId.includes('remaining_time') || entityId.includes('remaining_program_time') || entityId.includes('program_progress')) {
                                vl.realDevice.attributes.remaining_time = newState.state;
                                if (newState.attributes?.unit_of_measurement) {
                                    vl.realDevice.attributes.remaining_time_unit = newState.attributes.unit_of_measurement;
                                }
                                vl._cycleChangedTimePending = false;
                            }
                            if (entityId.includes('door')) {
                                vl.realDevice.attributes.door_open = (newState.state === 'on' || newState.state === 'open');
                            }
                            if (entityId.includes('child_lock')) {
                                vl.realDevice.attributes.child_lock = (newState.state === 'on' || newState.state === 'true');
                            }
                            if (entityId.includes('lamp') || entityId.includes('light')) {
                                vl.realDevice.attributes.lamp_state = newState.state;
                            }
                            if (entityId.includes('cycle') || entityId.includes('program')) {
                                const prevCycle = vl.realDevice.attributes.cycle;
                                vl.realDevice.attributes.cycle = newState.state;
                                vl.realDevice.attributes.current_cycle = newState.state;
                                if (prevCycle && prevCycle !== newState.state) {
                                    vl._cycleChangedTimePending = true;
                                }
                            }
                            if (entityId.includes('total_time')) {
                                vl.realDevice.attributes.total_time = newState.state;
                                if (newState.attributes?.unit_of_measurement) {
                                    vl.realDevice.attributes.total_time_unit = newState.attributes.unit_of_measurement;
                                }
                                vl._cycleChangedTimePending = false;
                            }
                            if (entityId.includes('mode')) {
                                vl.realDevice.attributes.mode = newState.state;
                            }
                            if (entityId.includes('rinse_refill')) {
                                vl.realDevice.attributes.rinse_refill_needed = (newState.state === 'on');
                            }
                            if (entityId.includes('clean_indicator') || entityId.includes('clean_complete')) {
                                vl.realDevice.attributes.clean_complete = (newState.state === 'on');
                            }
                        }
                    }

                    // Render updates
                    if (isApplianceCard && (entityId.includes('cycle') || entityId.includes('program'))) {
                        if (vl._cardUpdateTimer) clearTimeout(vl._cardUpdateTimer);
                        vl.updateVisuals();
                    } else if (isApplianceCard) {
                        if (vl._cardUpdateTimer) clearTimeout(vl._cardUpdateTimer);
                        vl._cardUpdateTimer = setTimeout(() => {
                            vl.updateVisuals();
                        }, 50);
                    } else {
                        vl.updateVisuals();
                    }
                }
            });
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

    // Depth mesh disabled per user request
    if (xb.xrDepthMeshVisualizationOptions) {
        o.depth = new xb.DepthOptions(xb.xrDepthMeshVisualizationOptions);
        o.depth.enabled = false;
        if (o.depth.depthMesh) {
            o.depth.depthMesh.enabled = false;
            o.depth.depthMesh.showDebugTexture = false;
            o.depth.depthMesh.renderShadow = false;
        }
    }

    xb.init(o);

    if (xb.ui && xb.ui.setTheme) {
        xb.ui.setTheme({
            colors: {
                primary: '#FFFFFF',
                outline: 'rgba(255, 255, 255, 0.30)',
            }
        });
    }

    if (xb.scene && typeof scanningWeb !== 'undefined' && scanningWeb && scanningWeb.mesh) {
        xb.scene.add(scanningWeb.mesh);
    } else if (xb.add && typeof scanningWeb !== 'undefined' && scanningWeb && scanningWeb.mesh) {
        xb.add(scanningWeb.mesh);
    }

    // Mount Scripts immediately to start per-frame loops
    const getDeps = () => ({ virtualLights, smartHome, hud, VirtualLight3D });
    xb.add(new EasterEggManager(getDeps));
    xb.add(new HUDInteraction());

    // Attach XR Controller Listeners
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

    // 7. Load saved pairings from Firestore Native
    await loadSavedAnchors();
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

    let lastProcessedScanTime = 0;
    const handleDevicesFound = (lights, cameraMatrix) => {
        if (!lights || lights.length === 0) {
            console.log("[Vision] 0 devices in result.");
            return;
        }

        const now = Date.now();
        if (now - lastProcessedScanTime < 500) {
            console.log("[Vision] Skipping duplicate scan callback within 500ms");
            return;
        }
        lastProcessedScanTime = now;

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

// --- Firestore Anchor Restoration ---
async function loadSavedAnchors() {
    if (!smartHome || !smartHome.getSavedAnchors) return;
    try {
        console.log("[Persistence] Checking Firestore for saved anchors...");
        if (smartHome && smartHome.fetchLiveStates) {
            await smartHome.fetchLiveStates();
        }
        const anchors = await smartHome.getSavedAnchors();
        if (!anchors || anchors.length === 0) {
            console.log("[Persistence] No saved anchors found.");
            return;
        }

        console.log(`[Persistence] Loaded ${anchors.length} saved anchors:`, anchors);
        let restoredCount = 0;

        for (const anchor of anchors) {
            const devId = anchor.id || anchor.entity_id;
            if (!devId) continue;

            const existing = virtualLights.find(vl => vl.linkedNodeId === devId);
            if (existing) continue;

            const device = (smartHome.devices && smartHome.devices.get(devId)) || {
                id: devId,
                name: anchor.name || devId,
                area: anchor.area || 'Other',
                isOn: false
            };

            const label = anchor.name || anchor.label || device.name || devId;
            const cat = anchor.category || (device.domain || 'light');
            const mockGemini = { xmin: 0.4, xmax: 0.6, ymin: 0.4, ymax: 0.6, category: cat };
            const vLight = new VirtualLight3D(mockGemini, label, 0.36, 0.5);

            if (anchor.position) {
                vLight.position.set(anchor.position.x, anchor.position.y, anchor.position.z);
            }
            if (anchor.quaternion) {
                vLight.quaternion.set(anchor.quaternion.x, anchor.quaternion.y, anchor.quaternion.z, anchor.quaternion.w);
            }

            vLight.unpaired = false;
            vLight.linkedNodeId = devId;
            vLight.realDevice = device;
            vLight.labelText = label;
            vLight.label = label;
            vLight.hasBeenMoved = true;
            vLight.updateVisuals();

            virtualLights.push(vLight);
            if (xb.scene) {
                xb.scene.add(vLight);
            } else if (xb.add) {
                xb.add(vLight);
            }
            restoredCount++;
        }

        if (restoredCount > 0) {
            hud.speak(`Restored ${restoredCount} saved devices.`);
            hud.log(`Restored ${restoredCount} saved devices`, '#FFFFFF');
        }
    } catch (e) {
        console.warn("[Persistence] Error loading saved anchors:", e);
    }
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
        if (typeof scanningWeb !== 'undefined' && scanningWeb) {
            scanningWeb.show();
        }
        
        // Update all visual lights to toggle draggability OFF
        virtualLights.forEach(vl => vl.updateVisuals());
        
        // Update UI
        if (hud && hud.setScanState) hud.setScanState(true);
        hud.speak("Scanning started. Please pan around.");
        hud.log("Scanning Active...", '#00FF00');

    } else {
        // --- STOPPING SCAN ---
        isScanning = false;
        if (typeof scanningWeb !== 'undefined' && scanningWeb) {
            scanningWeb.hide();
        }
        
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
        
        realDevices = devices;
        
        console.log(`Loaded Devices: ${realDevices.length}`);

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

         // A. Check Explicit Link (nodeId or entity_id)
         if (vl.linkedNodeId) {
              matchedDevice = (smartHome && smartHome.devices && smartHome.devices.get(vl.linkedNodeId)) ||
                  realDevices.find(d => d.id === vl.linkedNodeId || d.nodeId === vl.linkedNodeId);
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
              const stillInSmartHome = vl.linkedNodeId && smartHome && smartHome.devices && smartHome.devices.has(vl.linkedNodeId);
              if (!stillInSmartHome && vl.realDevice && realDevices.length > 0) {
                   console.log(`[Link] Unlinked '${vl.labelText}'`);
                   vl.realDevice = null;
                   if (vl.mesh) vl.mesh.material.color.setHex(0xFFFF00); // Yellow (Unlinked)
                   if (vl.updateVisuals) vl.updateVisuals();
              }
          }

          // Poll State if linked (Throttle during scan)
          if (vl.realDevice && smartHome && !isScanning) {
              const isLock = (vl.realDevice.domain === 'lock' || vl.category === 'lock' || vl.realDevice.id.startsWith('lock.'));
              const currentDev = smartHome.devices.get(vl.realDevice.id);
              if (currentDev) {
                  const stateChanged = (vl.realDevice.state !== currentDev.state) ||
                                       (vl.isOn !== currentDev.isOn) ||
                                       (vl.realDevice.battery !== currentDev.battery) ||
                                       (vl.realDevice.fanSpeed !== currentDev.fanSpeed);
                  if (isLock) {
                      console.log(`[HA-DEBUG:linkLightsToDevices:LOCK-CHECK] ${vl.labelText} (${vl.realDevice.id}): vlState='${vl.realDevice.state}', vlIsOn=${vl.isOn} vs mapState='${currentDev.state}', mapIsOn=${currentDev.isOn}, stateChanged=${stateChanged}`);
                  }
                  if (stateChanged) {
                      if (isLock) {
                          console.warn(`[HA-DEBUG:linkLightsToDevices:LOCK-OVERWRITE!] Syncing/Overwriting Lock ${vl.labelText} from state='${vl.realDevice.state}'/isOn=${vl.isOn} to state='${currentDev.state}'/isOn=${currentDev.isOn}`);
                      } else {
                          console.log(`[Poll] Syncing State for ${vl.labelText}: ${currentDev.state || (currentDev.isOn ? 'ON' : 'OFF')}`);
                      }
                      vl.realDevice = currentDev;
                      vl.isOn = currentDev.isOn;
                      if (vl.mesh) {
                          const color = vl.isOn ? 0xFFFFFF : 0x00FF00;
                          vl.mesh.material.color.setHex(color);
                          vl.mesh.material.emissive.setHex(color);
                          vl.mesh.material.emissiveIntensity = vl.isOn ? 1.0 : 0.2;
                      }
                      if (vl.updateVisuals) {
                          vl.updateVisuals();
                      }
                      if (hud && hud.drawLights) hud.drawLights(virtualLights);
                  }
              }
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