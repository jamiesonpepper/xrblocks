# XRHome Demo (Matter Edition)

A WebXR Proof of Concept that combines **XRBlocks**, **Vertex Vision API**, and **Matter.js** for local smart home control via AR.

## Features

- **Room-Scale Scanning**: Detects lights using the device camera and Gemini Vision API.
- **Matter Integration**: Pairs with and controls real Matter smart lights over local WiFi/Thread.
- **3D Interaction**: Use XR controllers to point, click, and interact with virtual overlays.

## Usage Guide

### 1. Setup

1.  **Gemini API Key**: Enter your key in the HUD when prompted.
2.  **Matter Pairing Code**:
    - For new devices, use the QR code sticker.
    - For existing devices (already in Google Home), go to _Device Settings > Linked Matter Apps > Link Apps_ to get a new pairing code.

### 2. Scanning (New Paradigm)

The scanning system uses a decoupled loop for performance:

- **Live Capture (500ms)**: The camera continuously buffers the latest frame.
- **Analysis (5s)**: Every 5 seconds, the _latest_ frame is sent to Vertex Vision for analysis.
- **Action**: Click **"Start Scan"** in the HUD (or use voice command "Scan").
- **Result**: Detected lights appear as **Yellow Wireframe Boxes** in 3D space.

### 3. Visual Feedback (Color Coding)

The virtual boxes or device labels indicate the status of the device:

| Color         | Meaning            | Interaction                                                                                                             |
| :------------ | :----------------- | :---------------------------------------------------------------------------------------------------------------------- |
| 🟨 **Yellow** | **Unpaired / New** | Needs pairing. Shows a **Gear Icon (⚙️)** or a + icon.                                                                  |
| ⬜ **White**  | **Paired (ON)**    | Device is controlled and currently ON. In 2D shows a red X to unpair and in 3D shows a power button and unpair button.  |
| 🟩 **Green**  | **Paired (OFF)**   | Device is controlled and currently OFF. In 2D shows a red X to unpair and in 3D shows a power button and unpair button. |

### 4. Interactions

You can interact with the detected smart lights differently depending on your platform.

#### Pairing a Device

**In Desktop (2D) Mode:**

1.  Locate a **Yellow** box.
2.  Point at the **Gear Icon (⚙️)** and click.
3.  A standard browser prompt will appear.
4.  Enter the 11-digit Matter Pairing Code.
5.  The system will commission the device (this may take 10-30 seconds).
6.  Upon success, the box turns **Green/White** and the icon changes to an **X**.

**In Immersive AR (3D) Mode:**

1. Locate a Spatial Panel with **Yellow** text indicating an unpaired light.
2. Use your XR controller or hand/pinch gesture to point to and click the **"Plus"** icon.
3. A **Virtual Keypad** will spawn in 3D space.
4. Use your controller or hand/pinch to enter in the Matter Pairing Code on the virtual buttons.
5. Click **"OK"** to submit and commission the device (this may take 10-30 seconds).

#### Controlling a Light

**In Desktop (2D) Mode:**

- **Toggle On/Off**: Point at the **Main Box** (not the icon) and click. The box color will toggle between White and Green.

**In Immersive AR (3D) Mode:**

1. Locate a paired spatial panel (indicated by White or Green text).
2. Point at the **"Power/Toggle"** (Grey hover) button with your XR controller or hand/pinch gesture and click/trigger.
3. The physical light state will update, and the panel text will toggle between White (ON) and Green (OFF).

#### Unpairing

**In Desktop (2D) Mode:**

1.  Point at the **Red X Icon** on a paired device.
2.  Click to unpair. The box returns to **Yellow**.

**In Immersive AR (3D) Mode:**

1. Locate a paired spatial panel.
2. Point at the **"UNPAIR"** (Red hover) button with your XR controller and click/trigger.
3. The device will be removed from the local Matter fabric, and the text label will return to the Yellow state.

## Technical Setup (Developers)

### Docker (Linux/WSL2)

Required for Matter mDNS discovery on Linux.

```bash
docker build -t xrhome-demo .
docker run --name xrhome --network host -it --rm -p 8080:8080 xrhome-demo
```

frontend: `https://<hostname>:8080/demos/xrhome/index.html`

### Local Node.js (Windows/Mac)

Recommended for development.

```bash
npm install
npm run dev
```

Access at `https://<hostname>:8080/demos/xrhome/index.html` (Accept self-signed cert).
