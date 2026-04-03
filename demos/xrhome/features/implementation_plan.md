# Implementation Plan: House-Scale SLAM & Google Home Graph Integration

This plan outlines the approach to implementing the features described in `house_scale_slam.feature` and `google_home_mapping.feature`. We will modify the existing `demos/xrhome` codebase to integrate Firebase Realtime Database and Cloud Functions for a rigorous Cloud-to-cloud smart home fulfillment structure.

## Strategy: Cloud-to-cloud Firebase Architecture

Instead of utilizing local Matter UDP protocols and containerized SQLite logic, this flow pivots to serverless Firebase and Google Home Graph. The XR frontend will communicate directly with Firebase Realtime Database. Firebase Cloud Functions will map `EXECUTE` and `SYNC` intents, pushing `reportState` and responding to Google Assistant/Home Graph requests natively.

---

## Proposed Changes

### 1. Frontend Web App Modifications

We will modify the core codebase to incorporate Firebase SDKs and SLAM persistence directly into the existing app.

#### [MODIFY] `demos/xrhome/index.html`

- **Purpose**: Update entry point for Firebase and Cloud-to-cloud mapping.
- **Details**:
  - Add Firebase CDN dependencies (`firebase-app`, `firebase-auth`, `firebase-database`, `firebase-functions`).
  - Update the configuration overlay to actively prompt the user for their **Gemini API Key**, **Google Home Project ID**, and **OAuth details**. These credentials are required dynamically at runtime to power the Vertex vision module and sync with the Google Home Graph infrastructure. Firebase configuration variables (like the Firebase projectId and authDomain) will be statically bundled or securely loaded during the Firebase deploy.

#### [NEW] `demos/xrhome/slam-manager.js`

- **Purpose**: Implements the WebXR Anchors Module logic.
- **Details**:
  - Generates `XRAnchor`s based on `XRHitTestResult`s.
  - Pushes anchoring 3D coordinates and Anchor UUIDs to Firebase Realtime Database (replacing IndexedDB and SQLite) for real-time persistence across sessions and devices.

#### [MODIFY] `demos/xrhome/vision.js`

- **Purpose**: Augment with Vertex Vision for semantic understanding.
- **Details**:
  - Enhance the prompts for rigid Smart Home appliance recognition (Lights, Switches, TVs) returning structural bounding boxes.

#### [MODIFY] `demos/xrhome/main.js` & `demos/xrhome/hud.js`

- **Purpose**: Embed mapping capabilities and replace button assets.
- **Details**:
  - Overwrite local Matter integrations with Firebase Auth and Database listeners.
  - Allow the scanning operations in the HUD to scan and map any smart home devices via SLAM to the applicable WebXR anchors and store the positioning in Firebase Realtime database.
  - These positions should create spatial panels for each of the devices with an initial plus sign to link to the devices via Google Home Graph. Before a device is linked the spatial panel can be moved and the label for it is coloured yellow and the name and type of devices can be edited or changed and save and that information stored in Firebase Realtime Database as well.
  - When the first plus button is pressed the app will then query the Home Graph to find devices of the same type and a search prompt will allow filtering.
  - Once the spatial panel is linked power toggle, brightness +/-, colour, and disconnect buttons will be visible and the spatial panel will be locked in position and the label name colour set to green and the name or device type not editable.
  - Migrate legacy UI canvas interactions or Spatial Buttons to the newly adopted `uiblocks` architecture for modern styling.

### 2. Backend Infrastructure: Firebase Cloud Functions

We will discard the Docker/Express container approach in favor of stateless serverless architecture.

#### [NEW] `demos/xrhome/functions/index.js`

- **Purpose**: Serverless backend for Google Home Graph fulfillment.
- **Details**:
  - Utilize the `actions-on-google` smart home provider SDK.
  - Implement smart home fulfillment endpoints mapping `action.devices.SYNC`, `action.devices.QUERY`, and `action.devices.EXECUTE` intents.
  - Triggers on Realtime Database node updates to dynamically `reportState` back to the Home Graph API.

#### [MODIFY] Configuration and Deployment Structure

- **Purpose**: Move from Docker to the Firebase toolchain.
- **Changes**:
  - We will remove the `sqlite` dependencies and `Dockerfile` usage.
  - Initialize a `firebase.json` for hosting the static `xrhome` frontend and deploying the backend functions via `firebase deploy`.
  - The `package.json` will be updated to include deployment scripts (e.g., `"deploy": "firebase deploy"`) rather than Docker container orchestration.

---

## Verification Plan

### Pre-Requisite Setup

- Prompt the user to provide their valid **Gemini API Key** and **Google Home Project ID** so the environment can be fully credentialed and tested during execution.

### Automated/Unit Tests

- **Browser Subagent Test**: Stand up the application locally (e.g., via `firebase serve`) and use a browser subagent to automatically navigate to the URL, ensuring the application loads successfully and the credential configuration overlay is accessible and functions correctly.
- **Firebase Emulator Suites**: Use the Firebase Emulator to locally verify that Cloud Functions receive Realtime Database triggers and appropriately process mock `EXECUTE` commands before deploying.

### Manual Verification

1. **Frontend Boot**: Ensure the user can authenticate properly and pass the configuration screens.
2. **Database Write**: Confirm that planting a SLAM Anchor generates a real-time log within the Firebase Console's Database Viewer.
3. **Home Graph Sync**: Verify within Google Cloud Console / Firebase Console that the Cloud Function successfully issues the Home Graph sync payload without permission errors on toggle.
