# Implementation Plan: House-Scale SLAM & Google Home Graph Integration

This plan outlines the approach to implementing the features described in `house_scale_slam.feature` and `google_home_mapping.feature`. We will modify the existing `demos/xrhome` codebase to integrate Firebase Realtime Database and Cloud Functions for a rigorous Cloud-to-cloud smart home fulfillment structure.

## Strategy: Cloud-to-cloud Firebase Architecture

Instead of utilizing local Matter UDP protocols and containerized SQLite logic, this flow pivots to serverless Firebase and Google Home Graph. The XR frontend will communicate directly with Firebase Realtime Database. Firebase Cloud Functions will map `EXECUTE` and `SYNC` intents, pushing `reportState` and responding to Google Assistant/Home Graph requests natively.

---

## Proposed Changes

### 1. Frontend Web App Architecture & Refactoring

Adhering to the `frontend-ui-engineering` and `api-and-interface-design` system skills, we will decouple the monolithic `main.js` by extracting data fetching, presentation, and hardware state into focused, composable modules.

#### [MODIFY] `demos/xrhome/index.html`

- **Purpose**: Update entry point securely.
- **Details**:
  - Add Firebase CDN dependencies.
  - Update the configuration overlay to actively prompt the user for their **Gemini API Key**, **Google Home Project ID**, and **OAuth details**. Firebase configuration variables will be securely loaded during the Firebase deploy.

#### [NEW] `demos/xrhome/services/slam-persistence.js`

- **Purpose**: Implements the WebXR Anchors Module logic.
- **Details**:
  - Generates `XRAnchor`s based on `XRHitTestResult`s.
  - Pushes anchoring 3D coordinates and Anchor UUIDs to Firebase Realtime Database for real-time persistence across sessions and devices.

#### [NEW] `demos/xrhome/services/firebase-home-graph.js`

- **Purpose**: Data Container mapping for Smart Home Graph queries.
- **Details**:
  - Encapsulates Firebase Database reads/writes, keeping network logic cleanly separated from rendering.

#### [NEW] `demos/xrhome/components/smart-device-panel.js`

- **Purpose**: Presentation component for mapped devices using `uiblocks`.
- **Details**:
  - Implements the spatial UI lifecycle:
    - **Scanning State**: Yellow labels, movable panels, "+" link button.
    - **Query State**: Displays robust loading skeletons while querying the Home Graph to find devices of the same type via a searchable house/room tree.
    - **Linked State**: Green labels, locked position, official Google Home device name, exposing discrete power/brightness/color controls.
    - **Error/Empty States**: Reverts UI state on Firebase sync failures and displays structured, actionable empty states if Home Graph queries return zero devices.

#### [MODIFY] `demos/xrhome/vision.js`

- **Purpose**: Augment existing Vertex Vision for semantic understanding.
- **Details**:
  - Enhance the prompts for rigid Smart Home appliance recognition (Lights, Switches, TVs, robot vacuums, etc.) returning structural bounding boxes.

#### [MODIFY] `demos/xrhome/main.js` & `demos/xrhome/hud.js`

- **Purpose**: Lean orchestration and persistent system HUD.
- **Details**:
  - **Refactor**: Strip the 1800+ line spatial panel mapping and selection code out of `main.js` into the discrete components listed above.
  - **HUD Preservation & Upgrade**: Retain and modernize `hud.js` (potentially using `uiblocks` for consistency) to serve as the primary spatial dashboard. This HUD will:
    - Provide an explicit UI toggle to **Start / Stop SLAM Scanning**.
    - Display persistent, real-time status logs for scanning progress, Firebase synchronization, and Home Graph action successes or failures.

### 2. Backend Infrastructure: Firebase Hosting, Cloud Functions and Realtime Database

We will discard the Docker/Express container approach in favor of stateless serverless architecture, utilizing the newly integrated **Firebase MCP Server** to manage configuration, initialization, and deployment tasks.

#### [NEW] `demos/xrhome/functions/index.js`

- **Purpose**: Serverless backend for Google Home Graph fulfillment.
- **Details**:
  - Utilize the `actions-on-google` smart home provider SDK.
  - Implement smart home fulfillment endpoints mapping `action.devices.SYNC`, `action.devices.QUERY`, and `action.devices.EXECUTE` intents.
  - Triggers on Realtime Database node updates to dynamically `reportState` back to the Home Graph API.

#### [MODIFY] Configuration and Deployment Structure

- **Purpose**: Move from Docker to the Firebase toolchain via MCP.
- **Changes**:
  - We will remove the `sqlite` dependencies and `Dockerfile` usage.
  - Leverage the **Firebase MCP server** (`firebase_init` tool) to programmatically initialize Firebase Hosting, Functions, and Realtime Database directly via agent commands.
  - The `package.json` will be updated to include deployment scripts (e.g., `"deploy": "firebase deploy"`) which interact securely with the MCP ecosystem.

---

## Agent Guidelines & Skill Utilization

> [!NOTE]
> All future development and feature implementation for this plan will strictly adhere to the provided **System Skills** (e.g., `frontend-ui-engineering`, `test-driven-development`, `api-and-interface-design`). This structured agentic approach ensures resilient modular code, robust loading states, and components smaller than 200 lines.

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
