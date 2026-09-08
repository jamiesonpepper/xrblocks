import * as THREE from 'three';
import * as xb from 'xrblocks';

/**
 * HUDManager
 * Renders an immersive 3D spatial menu using xb.SpatialPanel.
 * Implements a flawless, monochromatic Jetpack Glimmer aesthetic.
 */
export class HUDManager {
    constructor() {
        this.mesh = null; // 2D Canvas Mesh (Legacy/2D)
        this.panel = null; // 3D SpatialPanel
        this.mode = '3D';
        
        // 2D Canvas for Desktop Mode
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.lines = []; 
        this.maxLines = 5;
        this.isScanning = false;
        
        // 3D UI Refs
        this.statusText = null;
        this.scanButton = null;
        this.logGrid = null;
    }

    speak(text) {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            window.speechSynthesis.speak(utterance);
        }
    }
    
    init(parent, mode = '3D') {
        this.mode = mode;
        
        if (mode === '2D') {
            this.init2D(parent);
        } else {
            this.init3D(parent);
        }
    }

    init2D(parent) {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        
        this.canvas.style.position = 'fixed';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.zIndex = '1000';
        this.canvas.style.pointerEvents = 'none';
        
        window.addEventListener('resize', () => {
             this.canvas.width = window.innerWidth;
             this.canvas.height = window.innerHeight;
             this.draw2D();
        });

        if (parent && parent.appendChild) {
            parent.appendChild(this.canvas);
        } else {
            document.body.appendChild(this.canvas);
        }
        this.draw2D();
    }

    init3D(scene) {
        this.scene = scene;
        this.isMenuExpanded = true;

        let cam = null;
        try {
            if (xb.renderer?.xr?.isPresenting) {
                cam = xb.renderer.xr.getCamera();
            } else {
                cam = xb.core?.camera || xb.camera;
            }
        } catch (e) {}

        const camPos = new THREE.Vector3();
        const camDir = new THREE.Vector3();

        if (cam) {
            cam.getWorldPosition(camPos);
            cam.getWorldDirection(camDir);
            // Place 1.2m in front of where the user is looking
            this.menuPos = camPos.clone().add(camDir.multiplyScalar(1.2));
            // Set at comfortable chest/eye level
            this.menuPos.y = Math.max(1.25, camPos.y - 0.1);
        } else {
            this.menuPos = new THREE.Vector3(0, 1.35, -1.2);
        }

        this.menuRot = new THREE.Euler(0, 0, 0);
        this.renderMenu();

        if (cam) {
            this.panel.lookAt(camPos);
        }
        console.log("HUD initialized in 3D Mode (UICard) at Y =", this.menuPos.y);
    }

    renderMenu() {
        if (this.panel) {
            this.menuPos.copy(this.panel.position);
            this.menuRot.copy(this.panel.rotation);
            if (this.scene) {
                this.scene.remove(this.panel);
            } else if (xb.remove) {
                xb.remove(this.panel);
            }
        }

        // Collapsed shows only 1 line, Expanded shows 4
        const maxLines = this.isMenuExpanded ? 4 : 1;
        this.logLines3D = [];
        const logChildren = [];
        for (let i = 0; i < maxLines; i++) {
            const txt = new xb.UIText({
                text: '',
                style: {
                    fontSize: 14,
                    color: '#ffffff',
                    width: '100%',
                }
            });
            this.logLines3D.push(txt);
            logChildren.push(txt);
        }

        this.scanButton = new xb.UIButton({
            label: this.isScanning ? "STOP SCAN" : "START SCAN",
            icon: this.isScanning ? "stop" : "search",
            style: {
                width: '100%',
                height: 40,
                borderRadius: 12,
                backgroundColor: this.isScanning ? 'rgba(255, 59, 48, 0.4)' : 'rgba(255, 255, 255, 0.18)',
                borderWidth: 1,
                borderColor: '#FFFFFF',
            },
            onClick: () => {
                if (this.onScanToggle) this.onScanToggle();
            }
        });

        const toggleBtn = new xb.UIButton({
            label: this.isMenuExpanded ? '−' : '+',
            ariaLabel: 'Toggle HUD expand',
            style: {
                width: 36,
                height: 36,
                borderRadius: 8,
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                borderWidth: 1,
                borderColor: '#FFFFFF',
            },
            onClick: () => {
                this.isMenuExpanded = !this.isMenuExpanded;
                this.renderMenu();
            }
        });

        const headerRow = new xb.UIPanel({
            style: {
                width: '100%',
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
            },
            children: [
                new xb.UIText({
                    text: "XR Home Control",
                    style: { fontSize: 18, fontWeight: 'bold', color: '#ffffff' }
                }),
                toggleBtn
            ]
        });

        const logPanel = new xb.UIPanel({
            style: {
                width: '100%',
                flexDirection: 'column',
                gap: 4,
                padding: 8,
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                borderWidth: 1,
                borderColor: 'rgba(255, 255, 255, 0.35)',
                borderRadius: 10,
            },
            children: logChildren
        });

        this.panel = new xb.UICard({
            size: { width: 0.54, height: 'auto' },
            manipulation: true,
            edge: { scale: true },
            style: {
                flexDirection: 'column',
                gap: 12,
                padding: 16,
                backgroundColor: 'rgba(255, 255, 255, 0.12)',
                borderWidth: 1.5,
                borderColor: '#FFFFFF',
                borderRadius: 20,
            },
            children: [
                headerRow,
                logPanel,
                this.scanButton
            ]
        });

        this.panel.position.copy(this.menuPos);
        this.panel.rotation.copy(this.menuRot);

        if (this.scene) {
            this.scene.add(this.panel);
        } else {
            xb.add(this.panel);
        }

        this.sync3DLogs();
    }
    
    enforceDepth() {
        // Handled natively by UICard
    }
    
    sync3DLogs() {
        if (!this.logLines3D) return;
        const maxDisplayed = this.logLines3D.length;
        const startIdx = Math.max(0, this.lines.length - maxDisplayed);
        for (let i = 0; i < maxDisplayed; i++) {
             const lineData = this.lines[startIdx + i];
             if (this.logLines3D[i]) {
                  this.logLines3D[i].text = lineData ? lineData.text : "";
             }
        }
    }

    drawLights(lights) {
        this.currentLights = lights;
        if (this.mode === '2D') this.draw2D();
    }
    
    setScanState(scanning) {
        this.isScanning = scanning;
        if (this.mode === '2D') {
            this.draw2D();
        } else if (this.scanButton) {
            this.scanButton.label = scanning ? "STOP SCAN" : "START SCAN";
            this.scanButton.icon = scanning ? "stop" : "search";
        }
    }

    draw2D() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        ctx.clearRect(0, 0, w, h);
        this.configRects = []; 
        
        ctx.font = '24px Arial';
        ctx.textAlign = 'left';
        
        this.lines.forEach((line, i) => {
            const y = 100 + i * 35;
            ctx.fillStyle = 'black';
            ctx.fillText(line.text, 22, y + 2);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(line.text, 20, y);
        });

        const scanY = h - 100;
        const isScanning = this.isScanning;
        
        ctx.fillStyle = isScanning ? '#ffffff' : '#444444'; 
        ctx.fillRect(20, scanY, 140, 40);
        
        ctx.fillStyle = isScanning ? '#000000' : '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.font = 'bold 20px Arial';
        ctx.fillText(isScanning ? "STOP SCAN" : "START SCAN", 90, scanY + 28);
        
        this.scanButtonRect = { x: 20, y: scanY, w: 140, h: 40 };

        if (this.currentLights) {
            const video = document.getElementById('webrtc-video');
            let offsetX = 0, offsetY = 0, displayedW = w, displayedH = h;
            
            if (video && video.videoWidth) {
                const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
                displayedW = video.videoWidth * scale;
                displayedH = video.videoHeight * scale;
                offsetX = (w - displayedW) / 2;
                offsetY = (h - displayedH) / 2;
            }

            this.currentLights.forEach((l, i) => {
                const x1 = offsetX + l.xmin * displayedW;
                const y1 = offsetY + l.ymin * displayedH;
                const bw = (l.xmax - l.xmin) * displayedW;
                const bh = (l.ymax - l.ymin) * displayedH;
                
                const bx = x1;
                const by = y1;

                let color = '#FFFF00'; 
                const isPaired = !!(l.linkedNodeId || l.realDevice);
                const isOn = l.isOn;
                
                if (isPaired) {
                   color = isOn ? '#FFFFFF' : '#00FF00';
                }

                ctx.strokeStyle = color;
                ctx.lineWidth = 3;
                ctx.strokeRect(bx, by, bw, bh);

                ctx.fillStyle = color;
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
                ctx.shadowBlur = 0;

                const cfgX = bx + bw/2 + 60; 
                const cfgY = labelY - 15;
                const cfgSize = 24;

                if (isPaired) {
                    ctx.fillStyle = '#CC0000';
                    ctx.fillRect(cfgX, cfgY, cfgSize, cfgSize);
                    ctx.fillStyle = '#FFF';
                    ctx.font = '16px Arial';
                    ctx.fillText("X", cfgX + 12, cfgY + 18);
                } else {
                    ctx.fillStyle = '#555';
                    ctx.fillRect(cfgX, cfgY, cfgSize, cfgSize);
                    ctx.fillStyle = '#FFF';
                    ctx.font = '12px Arial';
                    ctx.fillText("SET", cfgX + 12, cfgY + 16);
                }

                if (!this.configRects) this.configRects = [];
                this.configRects[i] = { x: cfgX, y: cfgY, w: cfgSize, h: cfgSize, index: i, light: l };
                ctx.shadowBlur = 0;
            });
        }
    }

    checkClick(x, y) {
        if (this.mode !== '2D') return null;
        
        if (this.scanButtonRect) {
            const b = this.scanButtonRect;
            if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
                return { type: 'SCAN' };
            }
        }
        
        if (this.configRects) {
            for (const r of this.configRects) {
                if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                    return { type: 'CONFIG', light: r.light, index: r.index };
                }
            }
        }
        return null;
    }

    log(text, color = '#FFFFFF') {
        this.lines.push({ text, color: '#ffffff', time: Date.now() });
        if (this.lines.length > 5) this.lines.shift();
        
        if (this.mode === '2D') {
            this.draw2D();
        } else if (this.panel) {
            this.sync3DLogs();
        }
        console.log(`[HUD] ${text}`);
    }
    
    update(text) { this.log(text); }
}
