import * as THREE from 'three';
import * as xb from 'xrblocks';

/**
 * HUDManager
 * Renders text to a 2D Canvas and displays it on a 3D Plane.
 * This avoids external font loading issues and ensures visibility.
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
        this.menuPos = new THREE.Vector3(0, 1.5, -1.5);
        this.menuRot = new THREE.Euler(0, 0, 0);
        this.renderMenu();
        console.log("HUD initialized in 3D Mode (SpatialPanel) with Collapsible Design");
    }

    renderMenu() {
        if (this.panel) {
            this.menuPos.copy(this.panel.position);
            this.menuRot.copy(this.panel.rotation);
            if (this.scene) {
                this.scene.remove(this.panel);
            } else if (this.panel.parent) {
                this.panel.parent.remove(this.panel);
            }
        }

        const H_TOGGLE = 0.1;
        const H_HEADER = 0.15;
        const H_LINE = 0.08;
        const H_SPACE = 0.05;
        const H_BUTTON = 0.25;

        // Collapsed shows only 1 line, Expanded shows 3
        const maxLines = this.isMenuExpanded ? 3 : 1;
        const dynamicHistoryHeight = maxLines * H_LINE;
        
        const menuHeight = H_TOGGLE + H_HEADER + dynamicHistoryHeight + H_SPACE + H_BUTTON + H_SPACE;
        const getW = (h) => h / menuHeight;

        this.panel = new xb.SpatialPanel({
             width: 0.6,
             height: menuHeight,
             backgroundColor: '#2b2b2baa',
             showEdge: true,
             edgeColor: 'white',
             edgeWidth: 0.02,
        });
        this.panel.position.copy(this.menuPos);
        this.panel.rotation.copy(this.menuRot);
        
        if (this.scene) {
            this.scene.add(this.panel);
        } else {
            // Revert to global add if no parent cached
            xb.add(this.panel);
        }

        const grid = this.panel.addGrid();
        
        // 1. Top Right Karat Toggle
        const toggleRow = grid.addRow({ weight: getW(H_TOGGLE) });
        toggleRow.addCol({ weight: 0.8 }); // Left Spacer pushing karat right
        toggleRow.addCol({ weight: 0.2 }).addTextButton({
             text: this.isMenuExpanded ? '\u25B2' : '\u25BC', // Up/Down Triangles
             fontColor: '#ffffff',
             backgroundColor: '#444444',
             fontSize: 0.5,
        }).onTriggered = () => {
             this.isMenuExpanded = !this.isMenuExpanded;
             this.renderMenu();
        };

        // 2. Header
        grid.addRow({ weight: getW(H_HEADER) }).addText({
             text: "XR Home Control",
             fontSize: 0.08,
             textAlign: 'center',
             fontColor: '#4285f4'
        });

        // 3. Dynamic Status / Log Area
        this.logLines3D = [];
        for(let i = 0; i < maxLines; i++) {
             const row = grid.addRow({ weight: getW(H_LINE) });
             const txt = row.addText({
                 text: "",
                 fontSize: 0.05,
                 textAlign: 'left',
                 fontColor: '#ffffff',
                 paddingX: 0.05
             });
             this.logLines3D.push(txt);
        }
        
        // Safely sync historical text limits strictly up to current view max
        this.sync3DLogs();

        grid.addRow({ weight: getW(H_SPACE) });
        
        // 4. Scan Button Row (Centered, Constrained Circle)
        const btnRow = grid.addRow({ weight: getW(H_BUTTON) });
        btnRow.addCol({ weight: 0.35 }); // Left Spacer
        this.scanButton = btnRow.addCol({ weight: 0.3 }).addIconButton({
             text: this.isScanning ? "stop" : "play_arrow", 
             fontSize: 0.45, // Matches the sample size nicely inside a constrained weight
             backgroundColor: this.isScanning ? '#cc0000' : '#00aa00', 
             fontColor: '#ffffff'
        });
        btnRow.addCol({ weight: 0.35 }); // Right Spacer
        
        this.scanButton.onTriggered = () => {
             if (this.onScanToggle) this.onScanToggle();
        };
        
        grid.addRow({ weight: getW(H_SPACE) });
        
        // Force the spatial engine to respect math bounding box changes
        if (this.panel.updateLayouts) {
             this.panel.updateLayouts();
        }
        
        // Ensure Troika texts that generate asynchronously receive depth enforcement
        this.enforceDepth();
    }
    
    enforceDepth() {
        const doEnforce = () => {
            if (!this.panel) return;
            this.panel.traverse(child => {
                child.renderOrder = 601;
                if (child === this.panel.mesh) child.renderOrder = 600;

                if (child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach(m => {
                        m.depthTest = false;
                        m.depthWrite = false;
                        m.needsUpdate = true;
                    });
                }
            });
        };
        
        doEnforce();
        setTimeout(doEnforce, 50);
        setTimeout(doEnforce, 150);
    }
    
    sync3DLogs() {
        if (!this.logLines3D) return;
        const maxDisplayed = this.logLines3D.length;
        const startIdx = Math.max(0, this.lines.length - maxDisplayed);
        for(let i=0; i < maxDisplayed; i++) {
             const lineData = this.lines[startIdx + i];
             if (this.logLines3D[i]) {
                  this.logLines3D[i].text = lineData ? lineData.text : "";
                  this.logLines3D[i].fontColor = '#ffffff';
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
        } else {
            this.renderMenu();
            console.log("HUD 3D Scan State Render Menu:", scanning);
        }
    }

    draw2D() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        ctx.clearRect(0, 0, w, h);
        this.configRects = []; // Reset click targets
        
        // 1. Draw Text Log
        ctx.font = '24px Arial';
        ctx.textAlign = 'left';
        
        this.lines.forEach((line, i) => {
            const y = 100 + i * 35;
            ctx.fillStyle = 'black';
            ctx.fillText(line.text, 22, y + 2);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(line.text, 20, y);
        });

        // 1b. Scan Button (Bottom Left)
        const scanY = h - 100;
        const isScanning = this.isScanning;
        
        ctx.fillStyle = isScanning ? '#CC0000' : '#00AA00'; 
        ctx.fillRect(20, scanY, 140, 40);
        
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.font = 'bold 20px Arial';
        ctx.fillText(isScanning ? "STOP SCAN" : "START SCAN", 90, scanY + 28);
        
        this.scanButtonRect = { x: 20, y: scanY, w: 140, h: 40 };

        // 2. Draw Bounding Boxes (same as before)
        if (this.currentLights) {
             // ... (Reuse logic or keep it simple)
             // Copying box drawing logic for completeness if strict 2D used
             // For brevity, assuming 2D boxes are less critical in this refactor step, 
             // but user asked for "No modification to pairing...", so I should preserve it.
             // I will paste the previous box logic here.
             
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

                // Determine Color based on state
                let color = '#FFFF00'; // Default Yellow (Unpaired)
                // Check State (Logic shared with VirtualLight3D)
                const isPaired = !!(l.linkedNodeId || l.realDevice);
                const isOn = l.isOn;
                
                if (isPaired) {
                   color = isOn ? '#FFFFFF' : '#00FF00';
                }

                ctx.strokeStyle = color;
                ctx.lineWidth = 3;
                ctx.strokeRect(bx, by, bw, bh);

                // Label (Below)
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

                // Config Button (Beside Name) - GOLD STANDARD LAYOUT
                const cfgX = bx + bw/2 + 60; // Offset from center
                const cfgY = labelY - 15;
                const cfgSize = 24;

                if (isPaired) {
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

                // Store Config Box logic for Click Detection (ICON AREA ONLY)
                if (!this.configRects) this.configRects = [];
                this.configRects[i] = {
                    x: cfgX,
                    y: cfgY,
                    w: cfgSize,
                    h: cfgSize,
                    index: i,
                    light: l
                };
                
                ctx.shadowBlur = 0;
            });
        }
    }

    checkClick(x, y) {
        // Only for 2D mode
        if (this.mode !== '2D') return null;
        
        // 1. Scan Button
        if (this.scanButtonRect) {
            const b = this.scanButtonRect;
            if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
                return { type: 'SCAN' };
            }
        }
        
        // 2. Config/Pairing Icons (Labels)
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
            // Re-sync with the current grid view length
            this.sync3DLogs();
        }
        console.log(`[HUD] ${text}`);
    }
    
    // update(text) alias
    update(text) { this.log(text); }
}
