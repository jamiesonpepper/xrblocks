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
    this.value = '';
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
      height: 2.4, // Increased further to secure Close/Cancel icon hover circle inside boundaries
      backgroundColor: '#1a1a1ae6',
      showEdge: true,
      edgeColor: '#ffffff',
      edgeWidth: 0.04, // Doubled Edge too
      fontColor: '#ffffff',
      isDraggable: true,
      pixelDensity: 1024,
    });

    // Ensure mesh is interactive
    this.panel.isInteractive = true;
    // Removed this.panel.mesh.isDraggable = true; to allow Panel group drag behavior instead of mesh decoupling

    // The root group is the panel
    // Depth forcing is now handled dynamically in updateDisplay() to combat async Troika generation

    // The panel is the root group. This fixes DragManager math!
    this.group = this.panel;
    this.group.visible = false;

    // --- Build UI ---
    // FIX: Use addGrid() like HUD
    const grid = this.panel.addGrid();

    // ROW 0: Header
    const headerRow = grid.addRow({weight: 0.05});
    headerRow.addText({
      text: 'ENTER PAIRING CODE',
      fontSize: 0.08, // Reduced size
      fontColor: '#aaaaaa',
      textAlign: 'center',
    });

    // ROW 1: Display
    const displayRow = grid.addRow({weight: 0.15});
    this.displayText = displayRow.addText({
      text: '_',
      fontSize: 0.125, // Decreased to fit 21-digit Matter codes
      fontColor: '#00FF00', // Matrix Green
      textAlign: 'center',
      backgroundColor: '#000000',
    });

    // ROW 2: Numpad Grid
    // We need 4 rows of buttons:

    const numpadWeight = 0.7;
    const buttonRows = [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      ['DEL', '0', 'OK'],
      ['CANCEL'], // Added explicit cancel mechanism
    ];

    // Create sub-rows for buttons
    for (const rowChars of buttonRows) {
      const btnRow = grid.addRow({weight: numpadWeight / 4});

      for (const char of rowChars) {
        let bgColor = '#333333';
        let fgColor = '#ffffff';

        let isAction = false;
        let iconName = char;

        if (char === 'OK') {
          bgColor = '#00aa00';
          isAction = true;
          iconName = 'check_circle';
        } else if (char === 'DEL') {
          bgColor = '#aa0000';
          isAction = true;
          iconName = 'backspace';
        } else if (char === 'CANCEL') {
          bgColor = '#cc0000';
          isAction = true;
          iconName = 'cancel';
        }

        const col = btnRow.addCol({weight: 1.0 / rowChars.length});
        
        // Use IconButton universally for actions AND digits to inherit native circular hover scaling
        const btnOptions = {
          text: iconName,
          fontSize: 0.28,
          backgroundColor: isAction ? bgColor : '#adff2f', // transparent green-yellow hover naturally emerges from bg color
          fontColor: fgColor,
        };
        // For numbers, explictly force normal text rendering by assigning empty font 
        if (!isAction) {
             btnOptions.font = '';
        }
        
        const btn = col.addIconButton(btnOptions);
        btn.onTriggered = () => this.handleInput(char);
      }
    }

    // ROW 3: Bottom Spacer to secure Cancel bounding box hover circle limits
    grid.addRow({weight: 0.25});

    // Add to Parent
    if (parent && parent.add) {
      parent.add(this.group);
    }
  }

  open(initialValue, onEnter, onCancel) {
    this.value = initialValue || '';
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
      this.displayText.text = this.value || '_';
      // Check usage: does SpatialPanel Text update auto-refresh?
      // Usually yes, if it's a getter/setter.
      // If not, we might need a refresh call, but xb.SpatialPanel standard is reactive text property.

      // Force redraw of that item/row if supported, or panel update
      if (this.panel && this.panel.needsUpdate) {
        // this.panel.needsUpdate(); // If API exists
      }
    }
    
    // Ensure Troika texts that generate asynchronously receive depth enforcement
    this.enforceDepth();
  }

  enforceDepth() {
    const doEnforce = () => {
      if (!this.panel) return;
      this.panel.traverse((child) => {
        child.renderOrder = 901;
        if (child === this.panel.mesh) child.renderOrder = 900;

        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m) => {
            m.depthTest = false;
            m.depthWrite = false;
            m.needsUpdate = true;
          });
        }
      });
    };
    
    // Call synchronously and staggered to catch Troika mesh resolution frames
    doEnforce();
    setTimeout(doEnforce, 50);
    setTimeout(doEnforce, 150);
  }
}
