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
    const cardChildren = [];

    // Header
    cardChildren.push(new xb.UIText({
      text: 'ENTER PAIRING CODE',
      style: {
        fontSize: 16,
        color: '#aaaaaa',
        textAlign: 'center',
        width: '100%',
      }
    }));

    // Display
    this.displayText = new xb.UIText({
      text: '_',
      style: {
        fontSize: 20,
        color: '#00FF00',
        textAlign: 'center',
        width: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        padding: 8,
        borderRadius: 8,
      }
    });
    cardChildren.push(this.displayText);

    // Numpad Grid
    const buttonRows = [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      ['DEL', '0', 'OK'],
    ];

    for (const rowChars of buttonRows) {
      const rowButtons = [];
      for (const char of rowChars) {
        let iconName = undefined;
        let ariaLabel = undefined;
        if (char === 'OK') {
          iconName = 'check_circle';
        } else if (char === 'DEL') {
          iconName = 'backspace';
        }

        rowButtons.push(new xb.UIButton({
          label: char,
          icon: iconName,
          style: {
            flexGrow: 1,
            height: 44,
            borderRadius: 8,
          },
          onClick: () => this.handleInput(char),
        }));
      }

      cardChildren.push(new xb.UIPanel({
        style: {
          width: '100%',
          flexDirection: 'row',
          gap: 8,
          justifyContent: 'center',
        },
        children: rowButtons,
      }));
    }

    // Cancel Button
    cardChildren.push(new xb.UIButton({
      label: 'Cancel',
      icon: 'close',
      style: {
        width: '100%',
        height: 40,
        borderRadius: 8,
      },
      onClick: () => this.handleInput('CANCEL'),
    }));

    this.panel = new xb.UICard({
      size: { width: 0.5, height: 'auto' },
      manipulation: true,
      edge: { scale: true },
      style: {
        flexDirection: 'column',
        gap: 10,
        padding: 16,
        backgroundColor: 'rgba(25, 25, 30, 0.95)',
        borderRadius: 16,
      },
      children: cardChildren,
    });

    this.group = this.panel;
    this.group.visible = false;

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
    // Handled natively by UICard
  }
}
