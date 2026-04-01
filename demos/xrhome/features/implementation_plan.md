# Implementation Plan: House-Scale SLAM & Google Home Integration

This plan outlines the approach to implementing the features described in `house_scale_slam.feature` and `google_home_mapping.feature`. The primary constraint is to safely **co-exist** with the current `demos/xrhome` code without impacting the existing functionality.

## Strategy: Advanced Co-existence

Instead of heavily refactoring `main.js` and `matter-server.js` (which could destabilize the current app), we will create a parallel set of "advanced" entry points and modular files that share resources with the base demo but introduce the new capabilities.

---

## Proposed Changes

### 1. New Frontend Modules (WebXR SLAM & Google Home UI)

We will create new JavaScript modules mapped to the new Gherkin features to keep the logic isolated.

#### [NEW] `demos/xrhome/slam-manager.js`

- **Purpose**: Implements the WebXR Anchors Module logic for Feature #1.
- **Details**:
  - Subscribes to XR session events to request an `unbounded` reference space.
  - Generates `XRAnchor`s based on `XRHitTestResult`s when scanning.
  - Implements IndexedDB storage for persisting these anchor UUIDs and device coordinate offsets.

#### [NEW] `demos/xrhome/vision-advanced.js`

- **Purpose**: Augments SLAM with Vertex Vision for semantic understanding.
- **Details**:
  - Leverages Vertex Vision to detect Light Switches, Light Fixtures with bulbs powered off, and other Smart Home devices based on 2D bounding boxes and 3D depth correlation.
  - Passes these detections to the SLAM manager to be anchored.

#### [NEW] `demos/xrhome/hud-advanced.js`

- **Purpose**: Replaces the standard UI with an advanced mapping interface.
- **Details**:
  - Invokes the SLAM-based scanning routine.
  - Queries Google Home devices that can be assigned to the hitboxes determined by SLAM or Vertex Vision (Lights, Fixtures, Switches, or Smart Appliances).

#### [NEW] `demos/xrhome/google-home-client.js`

- **Purpose**: Implements frontend interaction with the Google Home APIs for Feature #2.
- **Details**:
  - Provides methods to fetch Google Home devices from the new backend API.
  - Handles the API requests triggered by `hud-advanced.js`.

### 2. New Backend Services

We will introduce a new server for Google Home integration, which will be started on port 8080.

#### [NEW] `demos/xrhome/google-home-server.js`

- **Purpose**: A standalone Express server providing the REST interface for the Android Home Device Control API and managing local persistence.
- **Details**:
  - Exposes endpoints like `/v1/home/devices` to list Google Home structures.
  - Exposes control endpoints `/v1/home/device/:id/toggle`.
  - Configured to run on port **8081** (allowing `matter-server.js` to occupy 8080 without conflicts).

#### [NEW] Data Storage Strategy (SQLite)

- **Purpose**: Provides persistent, relational mapping between WebXR Anchors and Google Home Devices entirely within the single Docker container.
- **Why SQLite**: To avoid the complexity of adding cross-container databases (like Redis or PostgreSQL) to the Docker-Compose structure, we will use the `sqlite3` npm package. This creates a lightweight `.db` file directly on the container's virtual filesystem (which can optionally be mounted to the host machine for out-of-container persistence).
- **Implementation**:
  - `google-home-server.js` will initialize a simple SQLite table (`DeviceMappings`) containing the `AnchorUUID` and the `GoogleHomeDeviceID`.
  - Exposes endpoints (`GET /v1/mappings`, `POST /v1/mappings`) for the frontend to save and restore the SLAM hitboxes.

#### [NEW] Configuration Management (`.env`)

- **Purpose**: Securely manage Gemini API keys, Google Home Project IDs, and OAuth credentials using standard environment files.
- **Details**:
  - We will incorporate the `dotenv` package into the backend servers to read from a standard `.env` file.
  - Users can mount this `.env` file directly into the Docker container (`docker run --env-file .env ...`) to keep secrets out of the codebase and UI forms (the UI overlay can still provide a fallback manual entry if these are not present).
  - A `demos/xrhome/.env.sample` file will be provided as a template.

#### [MODIFY] `demos/xrhome/Dockerfile`

- **Purpose**: Ensure the new `google-home-server.js` is built and exposed correctly alongside the original.
- **Changes**:
  - We will modify the Dockerfile to expose both ports (`8080` and `8081`).
  - The `CMD` will be updated (e.g., via a shell script or `concurrently`) to start **both** `matter-server.js` and `google-home-server.js` simultaneously. This allows the backend to serve both the original Matter workflow and the advanced Google Home workflow concurrently without requiring environment switching.

#### [MODIFY] `demos/xrhome/package.json`

- **Purpose**: Add new npm scripts to run the new backend safely.
- **Changes**:
  - Add script: `"start:google-home": "node google-home-server.js"`.
  - Add dependency: `"sqlite3": "^5.1.7"` for local container database storage.
  - Add dependency: `"dotenv": "^16.4.5"` for environment variable management.

### 3. Parallel Entry Points

To ensure the existing `index.html` and `main.js` are untouched, we will create "Advanced" entry points that boot the new modules.

#### [NEW] `demos/xrhome/index-advanced.html`

- **Purpose**: A visually identical copy of `index.html` but imports `main-advanced.js` instead of `main.js`.
- **Changes**:
  - Modified the `#config-overlay` form to prompt for `Google Home Project ID` and `OAuth Credentials` instead of Matter Codes.
  - These values will be stored as cookies until cleared, matching the existing `auth.js` pattern (or standard browser cookie APIs) for persistence.

#### [NEW] `demos/xrhome/main-advanced.js`

- **Purpose**: The main orchestration file for this new feature set.
- **Details**:
  - Imports `hud-advanced.js`, `vision-advanced.js`, `keypad.js` (reusing the existing keypad UI).
  - Integrates `slam-manager.js` for anchor-based scanning.
  - Integrates `google-home-client.js` to populate the `VirtualLight3D` instances with Google Home IDs rather than Matter node IDs.

### 4. UI Component Migration

#### [MODIFY] Button Components

- **Purpose**: Update the application's buttons to use the new `uiblocks` components provided by `xrblocks`.
- **Details**:
  - Transition existing button implementations in the UI overlays and spatial panels to use the new `uiblocks` components.
  - Ensure uniform styling, better ergonomics, and consistent interaction patterns provided by the `xrblocks` component library.

---

## Verification Plan

### Automated/Unit Tests

- **API Tests**: We will use `curl` to verify that `google-home-server.js` correctly exposes the `.get('/v1/home/devices')` endpoint on port 8081.
- **Docker Build**: Verify `docker build -t xrhome .` succeeds and the container successfully maps ports 8080 and 8081, running cleanly with a configured `--env-file .env`. Note: Because this advanced flow utilizes the cloud-based Android Home Device Control API instead of local Matter mDNS UDP broadcasts, the Docker container does **not** require host-network mode or local subnet connectivity to the smart devices. It only requires outbound HTTPS access to Google's cloud endpoints.

### Manual Verification

1. **Server Boot**: Verify the new Dockerized container boots correctly, logging startup for both `matter-server` (8080) and `google-home-server` (8081).
2. **Standard Demo Verification**: Open `index.html` (hitting 8080) and confirm the original local-Matter features still operate flawlessly.
3. **Advanced Demo UI**: Open `index-advanced.html` (also served by the 8080 static web host) and verify the OAuth and Project ID form renders, stores the cookie, and proceeds to the app.
4. **Advanced Demo WebXR Context**: Boot the WebXR context.
   - Verify the `unbounded` space is requested successfully.
   - Verify anchors are created when ceiling lights, lamps, or wall switches are detected.
   - Verify the mocked Google Home API devices render as mappable objects in the 3D space via `hud-advanced.js`.
