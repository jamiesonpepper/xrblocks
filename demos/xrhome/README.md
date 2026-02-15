# XRHome Demo (Matter Edition)

A WebXR Proof of Concept that combines **XRBlocks**, **Vertex Vision API**, and **Matter.js** for local smart home control.

This demo allows you to:

1.  **Scan** your environment using the device camera (WebRTC).
2.  **Identify** lamps and lights using Gemini Vision.
3.  **Control** real smart lights via **Matter Multi-Admin** (Local WiFi/Thread).
    - **Pinch**: Toggle Light On/Off.

## Prerequisites

1.  **Google Gemini API Key**: Get one from [Google AI Studio](https://aistudio.google.com/).
    14: 2. **Smart Lights Paired to Google Home**: > [!IMPORTANT] > **Requires Native Matter Devices**: The "Link Apps" menu in Google Home **ONLY** appears for Matter-enabled devices (e.g., newer Nest, Eve, Nanoleaf, tapo). > If your lights are standard WiFi/Zigbee (e.g. older Hue, LiFX, Cync) connected via Cloud, **you cannot control them locally with Matter**. > _This demo specifically showcases Matter Local Control._

15: 3. **Matter Pairing Code**: 3. **Matter Pairing Code**: You must obtain a "Link Apps" code from Google Home for each light you want to control. - _Google Home App > Device Settings > Linked Matter Apps & Services > Link Apps_.

## Setup & Running

You can run this project using Docker (Recommended for Linux) or Node.js (Recommended for Windows/Mac to ensure reliable network discovery).

### Option 1: Docker (Linux/WSL2)

Matter requires access to the host network for mDNS device discovery.

1.  **Build the Image**:

    ```bash
    docker build -t xrhome-demo .
    ```

2.  **Run with Host Networking**:

    ```bash
    docker run --name xrhome --network host -it --rm -p 8080:8080 xrhome-demo
    ```

    - Frontend: [http://localhost:8080/demos/xrhome/index.html](http://localhost:8080/demos/xrhome/index.html)
    - Backend: `http://localhost:3000`

    _Note: On Windows/Mac Docker Desktop, `--network host` may not fully expose mDNS. If device discovery fails, use Option 2._

### Option 2: Local Node.js (Windows/Mac)

1.  **Install Dependencies**:

    ```bash
    npm install
    ```

2.  **Start the Stack**:
    This runs both the Matter Controller backend and the Web Server.

    ```bash
    npm run dev
    ```

3.  **Open in Browser**:
    Navigate to [http://localhost:8080/demos/xrhome/index.html](http://localhost:8080/demos/xrhome/index.html).

## Usage

1.  **Configuration**: Enter your `Gemini API Key` in the HUD overlay.

2.  **Ensure Device is in Pairing Mode**
    - **New Device**: Power on and scan the QR code sticker (or enter code). It is usually in pairing mode for 15 minutes after power on.
    - **Existing Device (Google Home/Alexa)**: You must enable **Multi-Admin Pairing**.
      - Open Google Home App -> Tap Device -> Settings (Gear) -> Linked Matter Apps & Services -> "Link Apps & Services".
      - Use the **Pairing Code** provided there. This puts the device back into advertisement mode.
    - **Without Pairing Mode**: The controller cannot find the device, even if the code is correct.

3.  **Access the Application**
    - Open `https://localhost:8080` (Accept the self-signed cert warning).
    - Click "Start Scanning".
    - When a light is found and you click "Pair New Device", enter the code from Step 2.\*\* from Google Home.
    * Wait for the "Device Paired!" message.
4.  **Scanning**:
    - Click **Start Scan** (or say "Scan").
    - Point camera at a light.
5.  **Control**:
    - The detected light will be highlighted.
    - **Pinch** the virtual marker to toggle the real light.
