import * as THREE from 'three';

/**
 * DeviceMenu
 * Renders a list of devices to a 3D plan using CanvasTexture.
 * Allows selecting a device to link to a Virtual Light.
 */
export class DeviceMenu {
    constructor() {
        this.group = new THREE.Group();
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        
        this.width = 512;
        this.height = 512;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        
        this.texture = new THREE.CanvasTexture(this.canvas);
        
        this.devices = [];
        this.filteredDevices = [];
        this.searchQuery = "";
        this.onSelect = null; // Callback(device)
        this.onSpeak = null; // Callback(text)
        this.visible = false;
        
        this.debounceTimer = null;
    }
    
    init(parent, mode = '3D') {
        this.mode = mode;
        if (mode === '2D') {
             // Desktop Mode: Centered Overlay
             this.canvas.style.position = 'fixed';
             this.canvas.style.top = '50%';
             this.canvas.style.left = '50%';
             this.canvas.style.transform = 'translate(-50%, -50%)';
             this.canvas.style.zIndex = '1001'; // Above HUD
             this.canvas.style.pointerEvents = 'auto'; // Clickable
             this.canvas.style.border = '2px solid #555';
             this.canvas.style.borderRadius = '8px';
             this.canvas.style.display = 'none'; // Hidden by default
             
             // Click Handler
             this.canvas.addEventListener('click', (e) => {
                 const rect = this.canvas.getBoundingClientRect();
                 const x = e.clientX - rect.left;
                 const y = e.clientY - rect.top;
                 // Normalize UV 0..1 (Y logic inverted in 3D usually, check handleClick)
                 // handleClick expects UV where 0 is bottom, 1 is top?
                 // "UV.y is 0 at bottom, 1 at top."
                 // Mouse Y is 0 at top.
                 const uv = {
                     x: x / rect.width,
                     y: 1.0 - (y / rect.height)
                 };
                 this.handleClick(uv);
             });
             
             if (parent && parent.appendChild) {
                 parent.appendChild(this.canvas);
             } else {
                 document.body.appendChild(this.canvas);
             }
        } else {
            // 3D Mode
            const geometry = new THREE.PlaneGeometry(1, 1);
            const material = new THREE.MeshBasicMaterial({ 
                map: this.texture,
                transparent: true, 
                side: THREE.DoubleSide
            });
            
            this.mesh = new THREE.Mesh(geometry, material);
            this.group.add(this.mesh);
            this.group.visible = false;
            this.group.position.set(0, 1.6, -1.5); 
            
            if (parent && parent.add) {
                parent.add(this.group);
            }
        }
    }
    
    show(devices, onSelect, onSpeak) {
        this.devices = devices;
        this.filteredDevices = devices; // Show all initially
        this.searchQuery = "";
        this.onSelect = onSelect;
        this.onSpeak = onSpeak;
        
        this.visible = true;
        
        if (this.mode === '2D') {
            this.canvas.style.display = 'block';
            // Force focus for keyboard?
            this.canvas.focus(); 
        } else {
            this.group.visible = true;
            this.group.position.set(0, 1.6, -1.0); // Bring closer
        }

        this.render();
        
        if (this.onSpeak) this.onSpeak("Device Menu Open. Select a device.");
    }
    
    hide() {
        this.visible = false;
        if (this.mode === '2D') {
            this.canvas.style.display = 'none';
        } else {
            this.group.visible = false;
        }
    }
    
    render() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;
        
        // BG
        ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.fillRect(0, 0, w, h);
        
        // Header
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 30px Arial';
        ctx.textAlign = 'center';
        ctx.fillText("Select Device", w/2, 40);
        
        // Close Button (Top Right)
        ctx.fillStyle = '#FF4444';
        ctx.fillRect(w - 50, 10, 40, 40);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 24px Arial';
        ctx.fillText("X", w - 30, 40);

        // List
        ctx.font = '24px Arial';
        const startY = 80;
        const rowH = 40;
        
        this.filteredDevices.forEach((d, i) => {
            const y = startY + i * rowH;
            
            // Highlight box if hovered? (Skip for now)
            ctx.fillStyle = '#444444';
            ctx.fillRect(10, y - 25, w - 20, rowH - 5);
            
            // Text
            ctx.fillStyle = '#00FF00';
            ctx.textAlign = 'left';
            // Show Alias or Device Type + ID
            const name = d.traits?.["sdm.devices.traits.Info"]?.customName || (d.type ? d.type.split('.').pop() : "Device") + " " + (d.id || "?");
            ctx.fillText(name, 20, y);

            // Unpair "Button" (Right Side)
            ctx.fillStyle = '#CC0000';
            ctx.fillRect(w - 90, y - 25, 80, 30);
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 16px Arial';
            ctx.textAlign = 'center';
            ctx.fillText("Remove", w - 50, y - 5);
            ctx.font = '24px Arial'; // Reset
        });
        
        this.texture.needsUpdate = true;
    }
    
    // Type a character (Keyboard)
    type(char) {
        if (!this.visible) return;
        
        if (char === "Backspace") {
            this.searchQuery = this.searchQuery.slice(0, -1);
        } else if (char.length === 1) {
            this.searchQuery += char;
        }
        
        this.render();
        this.scheduleSearch();
    }
    
    // Set full query (Voice)
    setQuery(text) {
        if (!this.visible) return;
        this.searchQuery = text;
        this.render();
        this.scheduleSearch();
    }
    
    scheduleSearch() {
        // Clear existing
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        
        // Set new (2 seconds)
        this.debounceTimer = setTimeout(() => {
            this.performSearch();
        }, 2000);
    }
    
    performSearch() {
        const q = this.searchQuery.toLowerCase();
        
        if (!q) {
            this.filteredDevices = this.devices;
        } else {
            this.filteredDevices = this.devices.filter(d => {
                const lowerInfo = (d.traits?.["sdm.devices.traits.Info"]?.customName || "").toLowerCase();
                const lowerType = d.type.toLowerCase();
                return lowerInfo.includes(q) || lowerType.includes(q);
            });
        }
        
        this.render();
        
        // Read Results
        if (this.onSpeak) {
            if (this.filteredDevices.length === 0) {
                this.onSpeak("No devices found matching " + this.searchQuery);
            } else {
                const names = this.filteredDevices.map(d => d.traits?.["sdm.devices.traits.Info"]?.customName || "Device").join(", ");
                this.onSpeak(`Found ${this.filteredDevices.length} devices: ${names}`);
            }
        }
    }
    
    // Handle Input
    selectTopResult() {
        if (!this.visible) return;
        if (this.filteredDevices.length > 0) {
            const device = this.filteredDevices[0];
            console.log("Menu Selected (Enter):", device);
            if (this.onSelect) this.onSelect(device);
            this.hide();
        } else {
            if (this.onSpeak) this.onSpeak("No devices to select.");
        }
    }

    // Handle Input
    // uv is Vector2 (0..1) from Raycast
    // Handle Input
    // uv is Vector2 (0..1) from Raycast
    handleClick(uv) {
        if (!this.visible) return;
        
        // Map UV to Canvas Coords
        const canvasX = uv.x * this.width;
        // UV.y is 0 at bottom, 1 at top. Canvas Y is 0 at top.
        const canvasY = (1 - uv.y) * this.height;
        
        // Check Close Button (Top Right: w - 50, 10, 40, 40)
        if (canvasX > this.width - 50 && canvasX < this.width - 10 && canvasY > 10 && canvasY < 50) {
            console.log("Menu Closed via X");
            this.hide();
            return;
        }
        
        const startY = 80;
        const rowH = 40;
        
        if (canvasY > startY) {
            const index = Math.floor((canvasY - (startY - 25)) / rowH);
            if (index >= 0 && index < this.filteredDevices.length) {
                const device = this.filteredDevices[index];
                
                // Check if clicked "Unpair" (Right Side: w-100 to w)
                if (canvasX > this.width - 100) {
                     console.log("Requesting Unpair for:", device.id);
                     if (window.smartHome) {
                         window.smartHome.unpairDevice(device.id).then(success => {
                             if(success) {
                                 // Remove local
                                 this.filteredDevices.splice(index, 1);
                                 this.render(); // Redraw immediately
                                 if (this.onSelect) this.onSelect(null); // Trigger refresh
                             }
                         });
                     }
                     return;
                }

                console.log("Menu Selected:", device);
                if (this.onSelect) this.onSelect(device);
                // We keep it visible? Or hide? 
                // Usually selection hides it, but let the callback decide if they want to.
                // But for "Close once paired", the callback handles the logic.
                // Standard behavior: Hide on select.
                this.hide();
            }
        }
    }
}
