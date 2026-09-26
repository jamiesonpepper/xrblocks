import * as THREE from 'three';
import * as xb from 'xrblocks';

/**
 * VirtualKeypad
 * 3D UICard for entering numeric codes and security PINs.
 * Styled with XRHome translucent dark glassmorphism and crisp white borders.
 */
export class VirtualKeypad {
  constructor() {
    this.group = null;
    this.panel = null;
    this.value = '';
    this.title = 'ENTER PIN';
    this.masked = false;
    this.maxLength = 8;
    this.onEnter = null; // Callback(code)
    this.onCancel = null; // Callback()
    this.visible = false;

    // UI References
    this.headerText = null;
    this.displayText = null;
  }

  init(parent) {
    const cardChildren = [];

    // Header Title
    this.headerText = new xb.UIText({
      text: this.title,
      style: {
        fontSize: 16,
        color: '#FFFFFF',
        textAlign: 'center',
        width: '100%',
      }
    });
    cardChildren.push(this.headerText);

    // PIN Display Box
    this.displayText = new xb.UIText({
      text: '_',
      style: {
        fontSize: 22,
        color: '#FFFFFF',
        textAlign: 'center',
        width: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.40)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.25)',
        padding: 10,
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
            height: 42,
            borderRadius: 8,
          },
          onClick: () => this.handleInput(char),
        }));
      }

      cardChildren.push(new xb.UIPanel({
        style: {
          width: '100%',
          flexDirection: 'row',
          gap: 6,
          justifyContent: 'center',
        },
        children: rowButtons,
      }));
    }

    // Cancel / Dismiss Button
    cardChildren.push(new xb.UIButton({
      label: 'Cancel',
      icon: 'close',
      style: {
        width: '100%',
        height: 38,
        borderRadius: 8,
      },
      onClick: () => this.handleInput('CANCEL'),
    }));

    // Modern XRHome Translucent Glassmorphism UICard
    this.panel = new xb.UICard({
      size: { width: 0.40, height: 'auto' },
      anchorX: 'center',
      anchorY: 'top',
      manipulation: true,
      style: {
        flexDirection: 'column',
        gap: 8,
        padding: 14,
        backgroundColor: 'rgba(0, 0, 0, 0.20)',
        borderWidth: 1.5,
        borderColor: '#FFFFFF',
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

  /**
   * Open the keypad for input.
   * Supports both legacy string initialValue and options object:
   *   open('1234', onEnter, onCancel)
   *   open({ title: 'ENTER LOCK PIN', initialValue: '', masked: true, maxLength: 6 }, onEnter, onCancel)
   */
  open(optionsOrValue, onEnter, onCancel) {
    if (typeof optionsOrValue === 'object' && optionsOrValue !== null) {
      this.title = optionsOrValue.title || 'ENTER PIN';
      this.value = optionsOrValue.initialValue || '';
      this.masked = optionsOrValue.masked !== undefined ? !!optionsOrValue.masked : false;
      this.maxLength = optionsOrValue.maxLength || 8;
    } else {
      this.title = 'ENTER PIN';
      this.value = optionsOrValue || '';
      this.masked = false;
      this.maxLength = 16;
    }

    this.onEnter = onEnter;
    this.onCancel = onCancel;
    this.visible = true;

    if (this.headerText) {
      this.headerText.text = this.title;
    }

    if (this.group) {
      this.group.visible = true;
    }

    this.updateDisplay();
  }

  close() {
    this.visible = false;
    if (this.group) {
      this.group.visible = false;
    }
    this.onEnter = null;
    this.onCancel = null;
    this.value = '';
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
      if (this.value.length < this.maxLength) {
        this.value += char;
        this.updateDisplay();
      }
    }
  }

  updateDisplay() {
    if (this.displayText) {
      if (!this.value || this.value.length === 0) {
        this.displayText.text = '_';
      } else if (this.masked) {
        this.displayText.text = '•'.repeat(this.value.length);
      } else {
        this.displayText.text = this.value;
      }
    }
  }

  enforceDepth() {
    // Handled natively by UICard
  }
}
