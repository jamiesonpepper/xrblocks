# XRHome (Home Assistant & WebXR Edition)

# XRHome (Home Assistant & WebXR Edition)

A full-stack, room-scale WebXR spatial computing application powered by **XRBlocks**, **Google Gemini 2.5 Flash Vision**, and **Home Assistant Cloud (Nabu Casa)** with **Firebase Cloud Functions & Firestore** for persistent 3D spatial smart home control in Augmented Reality (AR) and Mixed Reality (MR).

---

## Key Capabilities & Features

### 1. House-Scale AI Room Scanning

- **Continuous Frame Buffering & Decoupled Analysis**: The headset/device camera feeds real-time video frames into a decoupled pipeline. Every 5 seconds, the latest captured frame is analyzed by **Google Gemini 2.5 Flash** using strict JSON schema output.
- **Multimodal Smart Device Detection**: Recognizes physical fixtures and appliances even when turned off:
  - 💡 **Lights & Lamps** (`light`)
  - 🔌 **Wall Switches & Smart Plugs** (`switch`)
  - 🔒 **Door Locks & Smart Deadbolts** (`lock`)
  - 🧹 **Robot Vacuums & Auto-Empty Docks** (`vacuum`)
  - 🍽️ **Dishwashers** (`dishwasher`)
  - 🍳 **Ovens, Stoves, Ranges & Microwaves** (`oven`)
  - 🐱 **Automatic Litter Boxes / Pet Care** (`litter_robot`)
  - ⚙️ **General Smart Appliances** (`appliance`)
- **Spatial Raycasting & Horizon Calibration**: Detected 2D bounding boxes are projected into 3D world space using camera pose matrices and WebXR depth/surface planes, spawning interactive 3D spatial cards directly over physical devices.

### 2. Hybrid Home Assistant Cloud Architecture

- **Zero-Latency Push Telemetry via WebSocket**: Connects directly from the headset browser to Home Assistant Cloud (`wss://<id>.ui.nabu.casa/api/websocket`) and subscribes to `state_changed` events. State changes (e.g. wall switch flips, door locks, dishwasher countdowns) update spatial cards in real-time (<50ms) without polling overhead.
- **Serverless Cloud Functions Gateway**: Securely provisions connection credentials (`getConfig`), unifies complex multi-entity appliances into cohesive virtual devices (`getHaDevices`), and executes commands (`controlHaDevice`) with automatic retries and error reporting.
- **Firestore Anchor Persistence**: Device pairings and 3D spatial anchors (position, rotation, device metadata) are saved to native Cloud Firestore (`saveAnchor`, `getAnchors`, `deleteAnchor`, `resetAnchors`). Anchors persist across sessions and headset reboots.

### 3. Dedicated Spatial UICards (`VirtualLight3D`)

Each device domain features a custom-engineered, glassmorphic 3D spatial panel with billboarding/pivoting to always face the user:

- **Smart Lights**: Power toggle, live brightness slider (1–100%), full-spectrum HSV color slider with dynamic preview swatch, warm/neutral/cool white temperature presets (2700K–6500K), and real-time color indicator reactivity.
- **Door Locks**: Locked/Unlocked status badge, battery level gauge, single-touch lock/unlock action button, and optimistic lock status handling with debounce.
- **Robot Vacuums**: Live status (Cleaning, Docked, Returning, Error), battery percentage, Clean/Pause toggle, Dock button, Spot clean button, and dock dustbin emptying.
- **Dishwashers**: Operating state badge, active cycle display (e.g. "Normal", "Heavy"), live countdown timer (`Xh Ym remaining` or `Less than a minute`), estimated completion timestamp (`Today at 4:15 PM`), door open/closed indicator, and rinse refill alert.
- **Ovens & Microwaves**: Status badge, cavity temperature setpoint (°F/°C), second cavity setpoint, live program remaining timer, cavity lamp control button ("Lamp ON / Lamp OFF"), Stop button, and door open warning.
- **Litter-Robot (Whisker)**: Status badge with full Home Assistant status code expansion (e.g., `rdy` → "Ready", `ccc` → "Clean Cycle Complete", `ccp` → "Clean Cycle In Progress", `cd` → "Cat Detected", `dfs` → "Drawer Full"), Litter Level percentage, Waste Drawer percentage, and a Home Assistant-mapped **Reset** button.
- **Thermostats (Climate)**: Ambient room temperature readout (°C), dynamic target setpoint linear slider with 0.5°C step buttons (featuring 🔥 Fire and ❄️ Snowflake mode icons), automatic dual-slider layout for Heat/Cool combo mode (individual low/high setpoint sliders), clickable HVAC mode controls (Heat, Cool, Heat / Cool, Off), live status badge, and compact auto-resizing in Off mode.
- **Smart Cameras (Live WebRTC via Google Nest SDM)**: Native real-time WebRTC live video streaming directly within the 3D UICard using Home Assistant's WebSocket API (`camera/webrtc/offer`). Conforms to Google Nest Smart Device Management (SDM) requirements (strictly ordered audio, video, and application datachannel m-lines), handles ICE candidate exchange, and pumps hardware-decoded video frames directly into WebXR rendering via `requestVideoFrameCallback` and the `XRRequestFrame` engine loop.
- **Device Tree Filtering**: Compound appliance sub-entities (e.g., loose sensors, buttons, cavity lights, subordinate thermostat sensors) are automatically unified and hidden from the pairing list, keeping the device tree clean and intuitive.

---

## User Interaction Guide

### 1. Initial Launch & HUD Setup

1. Launch the application in a WebXR-compatible browser (e.g., Meta Quest Browser or ChromeXR on AndroidXR):
   - **Hosting URL**: `https://<your-project-id>.web.app`
2. On boot, the system securely retrieves Home Assistant Cloud endpoints and tokens via `getConfig` and initializes the Home Assistant WebSocket stream.
3. The 3D HUD appears anchored in your field of view with scanning controls.

### 2. Room Scanning & Detecting Devices

1. Click **"Start Scan"** in the HUD (or use your controller / hand gesture).
2. Position yourself looking at some smart devices or appliances in the room. Try to remain as still as possible to get a clear image.
3. Detected fixtures appear as spatial panels with a text label or the detected device and a **"Pair Device"** label indicating an **Unpaired** state.
4. Click **"Stop Scan"** when finished.
5. To move an unpaired card, grab and drag it in 3D space using your controller grip or pinch gesture and move it to the desired location.
6. Any temporary placeholders are cleaned up automatically when a another scan is started.

### 3. Pairing a Spatial Panel to a Real Device

1. Point your controller ray or pinch gesture at an unpaired spatial card and click the **"Pair Device"** (`+`) button.
2. An interactive 3D device picker will open, listing your discovered Home Assistant devices categorized by room (e.g., Kitchen, Living Room, Utility) or by a Recommended filter.
3. Select the physical device from the list:
   - The card re-renders into its specialized UICard layout.
   - The device name updates to its Home Assistant friendly name.
   - The 3D world pose (position, rotation) and device link are saved to Firestore.

### 4. Controlling Devices in XR

- **Direct Touch & Ray Interaction**: Point your XR controller ray or use hand tracking pinch gestures to press buttons, drag brightness/color sliders, and switch temperature presets.
- **Unpairing**: Click the **"Unpair"** button at the bottom of any paired UICard to unlink it and return it to an unpaired state or remove it from Firestore.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                        XRHome WebXR Client                             │
│                  (Meta Quest / Mobile AR / Desktop)                    │
│                                                                        │
│   1. Boots XRBlocks & Three.js WebXR session                           │
│   2. Calls Cloud Function `getConfig` for secure credentials           │
│   3. Loads saved 3D device anchors from Firestore                      │
│   4. Opens direct WebSocket to Nabu Casa for push state updates        │
│   5. Runs Camera Frame Buffering -> Gemini 2.5 Flash Vision            │
│   6. Manages reactive 3D Spatial Panels (VirtualLight3D)               │
└──────────────┬──────────────────────────────────────────▲──────────────┘
               │                                          │
       (REST / Firestore)                         (Direct WSS Push)
               │                                          │
               ▼                                          │
┌──────────────────────────────┐              ┌───────────┴──────────────┐
│  Firebase Cloud Functions    │              │   Home Assistant Cloud   │
│      & Cloud Firestore       │              │        (Nabu Casa)       │
│                              │              │                          │
│  - getConfig                 │              │  - Real-time WebSocket   │
│  - getHaDevices (unification)│              │    state_changed stream  │
│  - controlHaDevice (REST)    │              │  - Sub-50ms push events  │
│  - saveAnchor / getAnchors   │              │  - 100+ connected smart  │
│  - deleteAnchor / resetAnchors              │    home device entities  │
└──────────────────────────────┘              └──────────────────────────┘
```

---

## Developer Setup & Deployment

### Prerequisites

- Node.js (v20+ or v22 LTS recommended)
- Firebase CLI (`npm install -g firebase-tools` or `npx firebase-tools`)
- A Home Assistant instance with Nabu Casa Cloud (or direct external URL)
- A Google Gemini API Key

### 1. Configuration & Secrets (`functions/.env`)

Create `demos/xrhome/functions/.env` using the provided sample template:

```bash
cp demos/xrhome/functions/.env.sample demos/xrhome/functions/.env
```

Populate the required environment variables:

```ini
# Home Assistant Cloud (Nabu Casa remote URL)
HA_URL=https://your-instance.ui.nabu.casa

# Home Assistant Long-Lived Access Token (Profile > Security > Long-Lived Access Tokens)
HA_TOKEN=your_long_lived_access_token_here

# Google Gemini API Key (for 2.5 Flash Vision object detection)
GEMINI_API_KEY=your_gemini_api_key_here

# Firebase Web API Key (for client-side Firebase Auth/Firestore)
WEB_API_KEY=your_firebase_web_api_key_here
```

### 2. Local Testing & Validation

Verify syntax and integrity across the project:

```bash
cd demos/xrhome
node --check main.js
node --check functions/index.js
node --check services/firebase-ha-integration.js
node --check vision.js
```

### 3. Deploying to Firebase

Deploy Cloud Functions and Hosting to your Firebase project:

```bash
cd demos/xrhome

# Deploy both Cloud Functions and Hosting
npx -y firebase-tools@latest deploy --project <your-project-id>

# Or deploy Hosting only:
npx -y firebase-tools@latest deploy --only hosting --project <your-project-id>

# Or deploy Cloud Functions only:
npx -y firebase-tools@latest deploy --only functions --project <your-project-id>
```

---

## Project Structure

```
demos/xrhome/
├── index.html                 # Main WebXR entry HTML & passthrough canvas
├── main.js                    # Core XR application, 3D UICards, drag & ray interaction
├── hud.js                     # 2D/3D Heads-Up Display and audio manager
├── vision.js                  # Gemini 2.5 Flash Vision integration & schema parser
├── keypad.js                  # 3D spatial virtual keypad for PIN entry and numeric input
├── webrtc.js                  # Camera feed capturing & frame management
├── auth.js                    # Firebase Auth client wrapper
├── services/
│   └── firebase-ha-integration.js  # WebSocket bus, state hydration & entity management
├── functions/
│   ├── index.js               # Cloud Functions (getHaDevices, controlHaDevice, anchors)
│   ├── .env.sample            # Environment variable template
│   └── package.json           # Cloud Functions dependencies (Node 22)
└── features/
    ├── hass_mapping.feature   # BDD feature spec: Home Assistant Cloud Device Mapping
    ├── house_scale_slam.feature # BDD feature spec: House-Scale SLAM & Spatial Anchoring
    └── implementation_plan.md # Architecture & integration design document
```
