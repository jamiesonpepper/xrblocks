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

The virtual boxes indicate the status of the device:

| Color         | Meaning            | Interaction                                |
| :------------ | :----------------- | :----------------------------------------- |
| 🟨 **Yellow** | **Unpaired / New** | Needs pairing. Shows a **Gear Icon (⚙️)**. |
| ⬜ **White**  | **Paired (ON)**    | Device is controlled and currently ON.     |
| 🟩 **Green**  | **Paired (OFF)**   | Device is controlled and currently OFF.    |

### 4. Interactions

Use your XR Controller (Laser Pointer) to interact.

#### Pairing a Device

1.  Locate a **Yellow** box.
2.  Point at the **Gear Icon (⚙️)** and click (Trigger).
3.  A **Virtual Keypad** will appear.
4.  Enter the 11-digit Matter Pairing Code.
5.  The system will commission the device (this may take 10-30 seconds).
6.  Upon success, the box turns **Green/White** and the icon changes to an **X**.

#### Controlling a Light

- **Toggle On/Off**: Point at the **Main Box** (not the icon) and click/pinch. The box color will toggle between White and Green.

#### Unpairing

1.  Point at the **Red X Icon** on a paired device.
2.  Click to unpair. The box returns to **Yellow**.

## Technical Setup (Developers)

### Docker (Linux/WSL2)

Required for Matter mDNS discovery on Linux.

```bash
docker build -t xrhome-demo .
docker run --name xrhome --network host -it --rm -p 8080:8080 xrhome-demo
```

frontend: `http://localhost:8080/demos/xrhome/index.html`

### Local Node.js (Windows/Mac)

Recommended for development.

```bash
npm install
npm run dev
```

Access at `https://localhost:8080` (Accept self-signed cert).
