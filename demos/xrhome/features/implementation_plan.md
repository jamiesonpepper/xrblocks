# Home Assistant Cloud Integration via Long-Lived Access Token

This plan refactors the device integration to use Home Assistant Cloud (Nabu Casa or remote access) instead of Google Home Graph. We will use a Long-Lived Access Token to authenticate with the Home Assistant API. This will allow us to retrieve a complete list of devices (entities) and assign thto spatial coordinates within the XR environment.

## Open Questions

> [!WARNING]
> **API Choice: REST vs WebSocket**
> Home Assistant offers both a REST API (`/api/states`) and a WebSocket API.
>
> - **REST API**: Very easy to fetch the initial device list for coordinate mapping.
> - **WebSocket API**: More complex to set up, but allows for instant real-time state updates (e.g., if a light is turned on physically, it instantly updates in XR without polling).
>
> Because we are routing traffic through Firebase Cloud Functions (which are stateless and short-lived), I propose we use the **REST API** for this implementation. This will easily let us fetch the device list for coordinate mapping, and simple REST `POST` calls to control them. Does this sound good?

## Proposed Changes

### 1. Configuration & Secrets Setup

We will update the environment configuration to store the Home Assistant URL and Token securely.

#### [MODIFY] `.env` and `sample.env`

- Add `HA_URL` (e.g., `https://my-home.ui.nabu.casa`).
- Add `HA_TOKEN` (The Long-Lived Access Token).
- These values will be deployed to Firebase Secret Manager, keeping them secure and out of the browser.

### 2. Backend Integration (Firebase Cloud Functions)

We will route traffic through Firebase to keep the token secure and avoid CORS issues.

#### [MODIFY] `functions/index.js` (HA Proxy Endpoints)

- Access `HA_URL` and `HA_TOKEN` from Firebase secrets.
- `getHaDevices`: A new Cloud Function that securely calls the Home Assistant `/api/states` endpoint and returns the filtered list of devices to the frontend.
- `controlHaDevice`: A new Cloud Function to send state changes (e.g., `/api/services/light/turn_on`) to Home Assistant.

### 3. Frontend Configuration (`index.html` & `main.js`)

#### [MODIFY] `index.html`

- Remove the Google Home Graph configuration inputs (Agent User ID, etc.) from the config UI completely. No other configuration UI should exist.

#### [MODIFY] `main.js` / `auth.js`

- Update the pairing/linking mode logic (triggered via the associated icon) to call the `/getHaDevices` Cloud Function.
- Filter the returned entities to relevant domains (e.g., `light.*`, `switch.*`, `media_player.*`).
- Pass this list to the spatial mapping UI so you can assign XR coordinates to specific HA entity IDs.

### 4. XR Spatial Mapping Integration

#### [MODIFY] `services/firebase-home-graph.js` (Rename to `firebase-ha-integration.js` or similar)

- Update the data model to store HA `entity_id`s mapped to spatial anchors in Firestore, rather than Google Home IDs.
- Update the execution logic: when a user interacts with a virtual device, trigger the HA service call via the `controlHaDevice` Cloud Function.

#### [MODIFY] `main.js` (Scanning Lifecycle Cleanup & Committing Anchors)

- Add logic to hook into the `toggleScan()` function.
- When the user **starts** a new "House Scan" session, iterate through all detected `virtualLights`.
- Any light from the previous session that does not have a `linkedNodeId` or `realDevice` (i.e., remains unmapped) should be destroyed from the scene to prevent ghostly artifacts.
- When a device is successfully mapped via the UI, immediately commit its XR coordinates to the Firebase Realtime Database.

#### [MODIFY] `main.js` (Selectable Device List UI)

- Update `VirtualLight3D` to handle a new "Selection Mode".
- When the user clicks the "link" icon on an unmapped spatial anchor, it should temporarily rebuild the spatial panel to show a paginated list of Home Assistant devices (e.g., 10 devices per page with Next/Prev buttons).
- Clicking a device in this list maps the anchor to that Home Assistant `entity_id`, exits selection mode, and restores the standard control UI.

## Verification Plan

### Manual Verification

1. Update your local `.env` with your `HA_URL` and `HA_TOKEN`.
2. Deploy the updated Cloud Functions (with the new secrets).
3. Open the XR application and click the icon to enter pairing/linking mode.
4. Verify that a list of your actual home devices is queried automatically and populates in the mapping wizard.
5. Assign a spatial coordinate to a specific HA entity (e.g., `light.office_lamp`).
6. Interact with the virtual device in XR and verify that the physical device state changes via the Home Assistant API.

### 5. HUD Refactor to `uiblocks` (Jetpack Glimmer)
The current HUD uses native `xb.SpatialPanel` instead of the newer `uiblocks` standard.
- **`index.html`**: Add `@pmndrs/uikit` and `yoga-layout` dependencies to the import map to support the `uiblocks` UI rendering engine.
- **`hud.js`**: Rewrite `HUDManager` to use `UICard`, `UIPanel`, `UIText`, and `UIIcon`.
- **Jetpack Glimmer Aesthetic**: We will replace the failing `#ffffff33` hex color with proper `uikit` translucent properties (e.g., solid colors with `opacity`, or dark glassmorphism effects) to achieve the premium Jetpack Compose Glimmer look.

### 6. Fixing Invisible Spatial Labels
The scanner detects 3 devices, but `VirtualLight3D` panels are not visible.
- **Scale & Sizing**: The `VirtualLight3D` is currently initializing with a tiny `0.15m` width. We will significantly increase the default dimensions and font sizes.
- **Font Scaling Lock**: As documented in the XRBlocks KI, we will ensure `mode: 'center'` is strictly enforced on all `addText` calls in `VirtualLight3D` to prevent the `fitWidth` scaling lock from crushing the text into a microscopic size.
- **Z-Depth Ordering**: Ensure the labels are pushed to the correct render layer so they don't clip inside the wall meshes.
