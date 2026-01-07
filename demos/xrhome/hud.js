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
    
    init(sceneOrXA) {
        // Create the plane
        // Aspect ratio 4:1 (1024x256)
        // Physical size: 2m wide x 0.5m high
        const geometry = new THREE.PlaneGeometry(2.0, 0.5);
        const material = new THREE.MeshBasicMaterial({ 
            map: this.texture,
            transparent: true,
            opacity: 1.0, 
            side: THREE.DoubleSide,
            depthTest: false, // Force on top? be careful
            depthWrite: false
        });
        
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.renderOrder = 999; // Force render last (on top)
        
        // Position: Fixed in front of user
        this.group.add(this.mesh);
        this.group.position.set(0, 2.0, -2.0); // 2m distance, slightly up
        
        if (sceneOrXA && sceneOrXA.add) {
            sceneOrXA.add(this.group);
        } else {
            console.warn("HUD: No scene provided to add to.");
        }
        
        // Initial Draw
        this.log("HUD Initialized");
    }
    
    /**
     * Updates the text on the HUD and logs to console.
     * @param {string} text 
     * @param {string} color (optional CSS color, default bright green)
     */
    log(text, color = '#00FF00') {
        console.log(`[HUD] ${text}`); // Console mirroring
        
        // Add to history
        this.lines.push({ text, color });
        if (this.lines.length > this.maxLines) {
            this.lines.shift();
        }

        const { width, height } = this.canvas;
        const ctx = this.ctx;
        
        // Clear
        ctx.clearRect(0, 0, width, height);
        
        // Background: Semi-transparent black box
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, width, height);
        
        // Render Lines
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.font = 'bold 40px "Courier New", monospace';
        
        let y = 10;
        const lineHeight = 48;
        
        for (const line of this.lines) {
            ctx.fillStyle = line.color || '#00FF00';
            ctx.fillText(line.text, 20, y);
            y += lineHeight;
        }
        
        // Update Texture
        this.texture.needsUpdate = true;
    }
    
    // Allow updating just the text
    update(text) {
        this.log(text);
    }
}
