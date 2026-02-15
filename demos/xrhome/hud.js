import * as THREE from 'three';
import * as xb from 'xrblocks';

/**
 * HUDManager
 * Renders text to a 2D Canvas and displays it on a 3D Plane.
 * This avoids external font loading issues and ensures visibility.
 */
export class HUDManager {
    constructor() {
        this.mesh = null;
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        
        // High resolution canvas for sharp text
        this.canvas.width = 1024;
        this.canvas.height = 256;
        
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.minFilter = THREE.LinearFilter;
        // this.texture.magFilter = THREE.LinearFilter;
        
        this.group = new THREE.Group();
        this.lines = []; // Store log history
        this.maxLines = 5;
    }

    speak(text) {
        if ('speechSynthesis' in window) {
            // Cancel previous to avoid backlog
            window.speechSynthesis.cancel();
            
            const utterance = new SpeechSynthesisUtterance(text);
            // utterance.rate = 1.1; // Slightly faster?
            window.speechSynthesis.speak(utterance);
        }
    }
    
    init(parent, mode = '3D') {
        this.mode = mode;
        if (mode === '2D') {
            // Desktop Mode: Full Screen Overlay
            this.canvas.style.position = 'fixed';
            this.canvas.style.top = '0';
            this.canvas.style.left = '0';
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.zIndex = '1000';
            this.canvas.style.pointerEvents = 'none';
            
            // Resize handler
            this.resize2D = () => {
                this.canvas.width = window.innerWidth;
                this.canvas.height = window.innerHeight;
                this.draw2D();
            };
            window.addEventListener('resize', this.resize2D);
            this.resize2D();

            if (parent && parent.appendChild) {
                parent.appendChild(this.canvas);
                console.log("HUD initialized in 2D Full-Screen Mode");
            } else {
                document.body.appendChild(this.canvas);
            }
        } else {
            // 3D/XR Mode: Create Plane
            const geometry = new THREE.PlaneGeometry(2.0, 0.5);
            const material = new THREE.MeshBasicMaterial({ 
                map: this.texture,
                transparent: true,
                opacity: 1.0, 
                side: THREE.DoubleSide,
                depthTest: false,
                depthWrite: false
            });
            
            this.mesh = new THREE.Mesh(geometry, material);
            this.mesh.renderOrder = 999;
            this.group.add(this.mesh);
            this.group.position.set(0, 2.0, -2.0); 

            if (parent && parent.add) {
                parent.add(this.group);
                console.log("HUD initialized in 3D Mode");
            }
        }
        this.log("HUD Initialized");
    }

    drawLights(lights) {
        this.currentLights = lights;
        if (this.mode === '2D') this.draw2D();
    }
    
    setScanState(scanning) {
        this.isScanning = scanning;
        if (this.mode === '2D') this.draw2D();
    }

    draw2D() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        ctx.clearRect(0, 0, w, h);
        
        // 1. Draw Text Log (Left Center)
        ctx.font = '24px Arial';
        ctx.textAlign = 'left';
        // Calculate vertical center
        const totalH = this.maxLines * 30; // approx height
        const startY = (h / 2) - (totalH / 2);
        
        this.lines.forEach((line, i) => {
            const y = startY + i * 35; // increased spacing
            // Shadow
            ctx.fillStyle = 'black';
            ctx.fillText(line.text, 22, y + 2);
            // Text
            ctx.fillStyle = line.color;
            ctx.fillText(line.text, 20, y);
        });

        // 1b. Scan Button (Under Status)
        const scanY = startY + this.lines.length * 35 + 20;
        
        // Dynamic Color/Text based on state
        const isScanning = this.isScanning || false;
        ctx.fillStyle = isScanning ? '#CC0000' : '#00AA00'; // Red (Stop) vs Green (Start)
        ctx.fillRect(20, scanY, 140, 40); // Slightly wider
        
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.font = 'bold 20px Arial';
        ctx.fillText(isScanning ? "STOP SCAN" : "START SCAN", 90, scanY + 28);
        
        // Store button rect for click check
        this.scanButtonRect = { x: 20, y: scanY, w: 140, h: 40 };

        // 2. Draw Bounding Boxes
        if (this.currentLights) {
            // ... (calc displayedW etc) ...
            
            // Get Video Dimensions if available for Aspect Ratio Correction
            // ... (Same logic as before, assuming unmodified context is safe to reference variables if I preserve them? No, I need to re-declare or ensure they are in scope)
            // Wait, I am replacing a block inside `draw2D`. I need to ensure variables are available.
            // The StartLine 106 is inside `draw2D`. `w` and `h` are available.
            
            // Re-declaring video logic for safety since I might be replacing the start of the block where it was?
            // No, the previous `replace` in step 1403 added the video logic *inside* the `if (this.currentLights)` block.
            // I am replacing from line 113 to 152. 
            // The video logic starts at 122. So I am overwriting it. I MUST restore it.
            
            const video = document.getElementById('webrtc-video');
            let offsetX = 0;
            let offsetY = 0;
            let displayedW = w;
            let displayedH = h;
            
            if (video && video.videoWidth) {
                const vw = video.videoWidth;
                const vh = video.videoHeight;
                const scale = Math.max(w / vw, h / vh);
                displayedW = vw * scale;
                displayedH = vh * scale;
                offsetX = (w - displayedW) / 2;
                offsetY = (h - displayedH) / 2;
            }

            this.currentLights.forEach(l => {
                // l has ymin, xmin, ymax, xmax (0-1) in Video Space
                // Map to Screen Space (Canvas)
                
                const x1 = offsetX + l.xmin * displayedW;
                const y1 = offsetY + l.ymin * displayedH;
                const x2 = offsetX + l.xmax * displayedW;
                const y2 = offsetY + l.ymax * displayedH;
                
                const bx = x1;
                const by = y1;
                const bw = x2 - x1;
                const bh = y2 - y1;

                // Determine Color based on state
                let color = '#FFFF00'; // Default Yellow (Unpaired)
                if (l.linkedNodeId || l.realDevice) {
                    color = l.isOn ? '#FFFFFF' : '#00FF00';
                }

                ctx.strokeStyle = color;
                ctx.lineWidth = 3;
                ctx.strokeRect(bx, by, bw, bh);

                // Label (Below)
                ctx.fillStyle = color;
                // Add black contour for white/yellow text readability?
                if (color === '#FFFFFF' || color === '#FFFF00') {
                    ctx.shadowColor = 'black';
                    ctx.shadowBlur = 4;
                } else {
                    ctx.shadowBlur = 0;
                }
                
                ctx.font = 'bold 16px monospace';
                ctx.textAlign = 'center';
                const labelY = by + bh + 20;
                ctx.fillText(l.label || "Light", bx + bw/2, labelY);
                ctx.shadowBlur = 0; // Reset
                
                // Config Button (Beside Name)
                // Draw Gear or "X" based on Pairing Status
                const cfgX = bx + bw/2 + 60; // Offset from center
                const cfgY = labelY - 15;
                const cfgSize = 24;
                
                if (l.realDevice) {
                    // PAIRED -> Show Red X (Unpair)
                    ctx.fillStyle = '#CC0000';
                    ctx.fillRect(cfgX, cfgY, cfgSize, cfgSize);
                    ctx.fillStyle = '#FFF';
                    ctx.font = '16px Arial';
                    ctx.fillText("✕", cfgX + 12, cfgY + 18);
                } else {
                    // UNPAIRED -> Show Gray Gear (Configure/Pair)
                    ctx.fillStyle = '#555';
                    ctx.fillRect(cfgX, cfgY, cfgSize, cfgSize);
                    ctx.fillStyle = '#FFF';
                    ctx.font = '12px Arial';
                    ctx.fillText("⚙️", cfgX + 12, cfgY + 16);
                }
                
                // Store config button rect for click check (store in light object or map?)
                // Accessing `l` here works. We can attach it to `l` for hit testing
                l.configRect = { x: cfgX, y: cfgY, w: cfgSize, h: cfgSize };
            });
        }
    }

    // Check for clicks on HUD elements (Scan button, Config buttons)
    // Returns action object or null
    // Check for clicks on HUD elements (Scan button, Config buttons)
    // Returns action object or null
    checkClick(x, y) {
        // x, y are Canvas Coordinates (Pixels)
        // No conversion needed if passed from clientX/Y
        
        // 1. Scan Button
        if (this.scanButtonRect) {
            const b = this.scanButtonRect;
            if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
                return { type: 'SCAN' };
            }
        }
        
        // 2. Config Buttons (on Lights)
        if (this.currentLights) {
            for (let i = 0; i < this.currentLights.length; i++) {
                const l = this.currentLights[i];
                if (l.configRect) {
                    const b = l.configRect;
                    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
                        return { type: 'CONFIG', index: i, light: l };
                    }
                }
            }
        }
        return null;
    }

    log(text, color = '#FFFFFF') {
        this.lines.push({ text, color, time: Date.now() });
        if (this.lines.length > 5) this.lines.shift();
        
        if (this.mode === '2D') {
            this.draw2D();
        } else {
            this.draw3D();
        }
        console.log(`[HUD] ${text}`);
    }

    draw3D() {
        // ... (Existing 3D drawing logic remains mostly same but using fixed canvas size)
        // For simplicity, reusing 2D draw logic but mapped to texture? 
        // No, 3D texture needs specific resolution (1024x256).
        // Let's keep a separate draw function or flags?
        // Actually, let's just use the text-only drawer for 3D for now.
        if (this.mode === '2D') return;

        const ctx = this.ctx;
        // ... (original draw code) ...
        // We need to restore original 3D drawing logic here if we changed it.
        // For now, let's assume `draw()` was the original 3D one.
        // Let's reimplement a simple one:
        
        ctx.clearRect(0, 0, 1024, 256);
        
        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, 0, 1024, 256);
        
        // Status Text (Left)
        ctx.font = '30px Arial';
        ctx.textAlign = 'left';
        
        this.lines.forEach((line, i) => {
            const y = 50 + i * 40;
            ctx.fillStyle = 'black';
            ctx.fillText(line.text, 22, y + 2);
            ctx.fillStyle = line.color || '#FFF';
            ctx.fillText(line.text, 20, y);
        });
        
        // Scan Status / Button (Right Side)
        const isScanning = this.isScanning || false;
        ctx.fillStyle = isScanning ? '#CC0000' : '#00AA00'; 
        ctx.fillRect(800, 20, 200, 60);
        
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.font = 'bold 24px Arial';
        ctx.fillText(isScanning ? "STOP SCAN" : "START SCAN", 900, 58); // Centered in button
        
        // Since we can't click the 3D HUD easily without raycasting (not implemented on HUD mesh yet),
        // This is mostly informational in 3D.
        
        this.texture.needsUpdate = true;
    }    
        
    // Allow updating just the text
    update(text) {
        this.log(text);
    }
}
