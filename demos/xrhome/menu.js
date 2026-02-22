import * as THREE from 'three';
import * as xb from 'xrblocks';

/**
 * VirtualKeypad
 * 3D UI for entering numeric codes (Matter Pairing Codes).
 * Refactored to use xb.SpatialPanel for consistent styling and input.
 */
export class VirtualKeypad {
    constructor() {
        // We no longer use a wrapper THREE.Group. We use SpatialPanel directly as the root.
        this.group = null; 
        this.panel = null;
        this.value = "";
        this.onEnter = null; // Callback(code)
        this.onCancel = null; // Callback()
        this.visible = false;
        
        // UI References
        this.displayText = null;
    }
    
    init(parent) {
        // Create Spatial Panel
        // Size: 0.6m x 0.8m
        this.panel = new xb.SpatialPanel({
            width: 1.6, // Doubled (was 0.8)
            height: 2.0, // Doubled (was 1.0)
            backgroundColor: '#1a1a1ae6', 
            showEdge: true,
            edgeColor: '#ffffff',
            edgeWidth: 0.04, // Doubled Edge too
            fontColor: '#ffffff',
            isDraggable: true, 
            pixelDensity: 1024 
        });
        
        // Ensure mesh is interactive
        this.panel.isInteractive = true;
        this.panel.mesh.isDraggable = true;
        
        // Force Keypad to render on top of spatial panels
        this.panel.traverse(child => {
            child.renderOrder = 999;
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => { m.depthTest = false; m.depthWrite = false; });
                } else {
                    child.material.depthTest = false;
                    child.material.depthWrite = false;
                }
            }
        });

        // The panel is the root group. This fixes DragManager math!
        this.group = this.panel;
        this.group.visible = false;

        // --- Build UI ---
        // FIX: Use addGrid() like HUD
        const grid = this.panel.addGrid();
        
        // ROW 0: Header & Close
        const headerRow = grid.addRow({ weight: 0.15 });
        headerRow.addText({
            text: "ENTER CODE",
            fontSize: 0.08, // Reduced size
            fontColor: '#aaaaaa',
            textAlign: 'left'
        });
        const closeBtn = headerRow.addCol({ weight: 0.3 }).addTextButton({
            text: "X",
            fontSize: 0.12,
            backgroundColor: '#cc0000',
            fontColor: '#ffffff',
            borderRadius: 0.05
        });
        closeBtn.onTriggered = () => this.cancel();

        // ROW 1: Display
        const displayRow = grid.addRow({ weight: 0.15 });
        this.displayText = displayRow.addText({
            text: "_",
            fontSize: 0.125, // Decreased to fit 21-digit Matter codes
            fontColor: '#00FF00', // Matrix Green
            textAlign: 'center',
            backgroundColor: '#000000'
        });

        // ROW 2: Numpad Grid
        // We need 4 rows of buttons:
        
        const numpadWeight = 0.7;
        const buttonRows = [
            ['1', '2', '3'],
            ['4', '5', '6'],
            ['7', '8', '9'],
            ['DEL', '0', 'OK'],
            ['CANCEL'] // Added explicit cancel mechanism
        ];
        
        // Create sub-rows for buttons
        for (const rowChars of buttonRows) {
            const btnRow = grid.addRow({ weight: numpadWeight / 4 });
            
            for (const char of rowChars) {
                let bgColor = '#333333';
                let fgColor = '#ffffff';
                
                if (char === 'OK') {
                    bgColor = '#00aa00';
                } else if (char === 'DEL') {
                    bgColor = '#aa0000';
                } else if (char === 'CANCEL') {
                    bgColor = '#cc0000';
                }
                
                const col = btnRow.addCol({ weight: 1.0 / rowChars.length });
                const btn = col.addTextButton({
                    text: char,
                    fontSize: 0.28, // Increased by 25% from 0.225
                    backgroundColor: bgColor,
                    fontColor: fgColor,
                    borderRadius: 0.05
                });
                
                btn.onTriggered = () => this.handleInput(char);
            }
        }

        // Add to Parent
        if (parent && parent.add) {
            parent.add(this.group);
        }
    }
    
    open(initialValue, onEnter, onCancel) {
        this.value = initialValue || "";
        this.onEnter = onEnter;
        this.onCancel = onCancel;
        this.visible = true;
        this.group.visible = true;
        
        // Ensure panel is rebuilt/ready if needed (SpatialPanel is usually static)
        this.updateDisplay();
    }
    
    close() {
        this.visible = false;
        this.group.visible = false;
        this.onEnter = null;
        this.onCancel = null;
    }
    
    cancel() {
        if (this.onCancel) this.onCancel();
        this.close();
    }
    
    handleInput(char) {
        if (char === 'OK') {
            if (this.onEnter) this.onEnter(this.value);
            this.close();
        } else if (char === 'CANCEL') {
            this.cancel();
        } else if (char === 'DEL') {
            this.value = this.value.slice(0, -1);
            this.updateDisplay();
        } else {
            // Digits (0-9)
            if (this.value.length < 21) {
                this.value += char;
                this.updateDisplay();
            }
        }
    }
    
    updateDisplay() {
        if (this.displayText) {
            this.displayText.text = this.value || "_";
            // Check usage: does SpatialPanel Text update auto-refresh? 
            // Usually yes, if it's a getter/setter.
            // If not, we might need a refresh call, but xb.SpatialPanel standard is reactive text property.
            
            // Force redraw of that item/row if supported, or panel update
            if (this.panel && this.panel.needsUpdate) {
               // this.panel.needsUpdate(); // If API exists
            }
        }
    }
}
