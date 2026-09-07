# XRHome Demo (Matter Edition)

A WebXR Proof of Concept that combines **XRBlocks**, **Vertex Vision API**, and **Matter.js** for local smart home control via AR.

## Features

- **Room-Scale Scanning**: Detects lights using the device camera and Gemini Vision API.
- **Matter Integration**: Pairs with and controls real Matter smart lights over local WiFi/Thread.
- **3D Interaction**: Use XR controllers or hand gestures to point, click, and interact with virtual overlays.

## Usage Guide

### 1. Setup

1.  **Gemini API Key**: Enter your key in the HUD when prompted.
2.  **Matter Pairing Code**:
    - For existing devices (already in Google Home), go to _Device Settings > Linked Matter apps & services > Link apps & services > Use Pairing_ to get a new pairing code.

### 2. Scanning

The scanning system uses a decoupled loop for performance:

- **Live Capture (500ms)**: The camera continuously buffers the latest frame.
- **Analysis (5s)**: Every 5 seconds, the _latest_ frame is sent to Vertex Vision for analysis.
- **Action**: Click **"Start Scan"** in the 2D HUD or the Start/Play button in the 3D HUD.
- **Result**: Scanned lights appear as **Yellow Wireframe Boxes** in 2D space or as XR Blocks spatial panels with **Yellow** text labels in 3D space.

### 3. Visual Feedback (Color Coding)

The virtual boxes or device labels indicate the status of the device:

| Color         | Meaning            | Interaction                                                                                                         |
| :------------ | :----------------- | :------------------------------------------------------------------------------------------------------------------ |
| 🟨 **Yellow** | **Unpaired / New** | Needs pairing. Shows a **Gear Icon (⚙️)** or a "**+**" icon.                                                        |
| ⬜ **White**  | **Paired (ON)**    | Device is paired and currently ON. In 2D shows a red X to unpair and in 3D shows a power button and unpair button.  |
| 🟩 **Green**  | **Paired (OFF)**   | Device is paired and currently OFF. In 2D shows a red X to unpair and in 3D shows a power button and unpair button. |

### 4. Interactions

You can interact with the detected smart lights differently depending on your platform.

#### Pairing a Device

**In Desktop (2D) Mode:**

1.  Locate a **Yellow** box.
2.  Point at the **Gear Icon (⚙️)** and click.
3.  A standard browser prompt will appear.
4.  Enter the 11-digit Matter Pairing Code from Google Home. (see above pairing instructions)
5.  The system will commission the device (this may take 10-30 seconds).
6.  Upon success, the box turns **Green/White** and the icon changes to a red **X**.

**In Immersive AR (3D) Mode:**

1. Locate a Spatial Panel with a **Yellow** text label indicating an unpaired light.
2. Use your XR controller or hand/pinch gesture to point to and click the **"+"** icon.
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

The architecture has been migrated from local node containers to a serverless model using Firebase Hosting and Cloud Functions, enabling secure 3rd-party integrations (Vertex AI, Google Home Graph).

### 1. Credentials & Secrets Setup (`.env.sample` and Auth)

To connect to Gemini, Google Home, and Firebase Auth:
1. Open `.env.sample` located in the root of the project.
2. Enter your `GEMINI_API_KEY`, `GOOGLE_HOME_PROJECT_ID`, and `WEB_API_KEY`.
3. Copy or rename this file to `.env` inside the `functions/` directory:
   ```bash
   cp .env.sample functions/.env
   ```
   *Note: Firebase Cloud Functions require local environment files to be stored inside the `functions` folder to be properly loaded during deployment!*

**Firebase Authentication:**
This demo uses Firebase Authentication with Google Sign-in to protect Realtime Database anchors.
1. Go to your [Firebase Console](https://console.firebase.google.com/).
2. Navigate to **Authentication** > **Sign-in method**.
3. Click **Add new provider** > **Google**.
4. Enable it and ensure your project's support email is configured.

### 2. Local Development (Emulators)

You can run the full Firebase suite locally without deploying:
   ```bash
   cd functions && npm install && cd ..
   firebase emulators:start
   ```

### 3. Deployment

To publish the static frontend and provision the backend REST APIs to the cloud:
   ```bash
   # Make sure your functions/.env is populated
   firebase deploy
   ```
