# Home Assistant Cloud WebSocket & Spatial Integration Plan

This document outlines the architecture and implementation for integrating Home Assistant Cloud (Nabu Casa) with XRHome using a **Hybrid Client WebSocket** architecture. This enables sub-millisecond, push-based real-time state telemetry (e.g., live countdowns, temperatures, toggles) directly on spatial UICards in AR/VR, while utilizing Firebase Cloud Functions for secure credential distribution, complex entity aggregation, and Firestore spatial anchor persistence.

## Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│                   XRHome Browser / Quest               │
│                                                        │
│  1. Fetch initial stitched devices & 3D anchors        │
│     via Cloud Functions (Secure / Cached)              │
│                                                        │
│  2. Open direct WebSocket to Nabu Casa:               │
│     wss://<remote-id>.ui.nabu.casa/api/websocket       │
│                                                        │
│  3. Subscribe to "state_changed" push events           │
└────────────┬─────────────────────────────▲─────────────┘
             │ (REST / Firestore)          │ (Direct WSS Push)
             ▼                             │
┌─────────────────────────┐   ┌────────────┴─────────────┐
│ Firebase Cloud Functions│   │ Home Assistant Cloud     │
│ & Firestore             │   │ (Nabu Casa WebSocket)    │
│                         │   │                          │
│ - Anchor Persistence    │   │ - Instant 0ms state push │
│ - Initial Stitched List │   │ - Real-time countdowns   │
└─────────────────────────┘   └──────────────────────────┘
```

---

## Technical Decisions & Status

> [!NOTE]
> **API Decision: Hybrid Client WebSocket (RESOLVED)**
> - **Initial Aggregation**: Firebase Cloud Function `getHaDevices` fetches the entity list, parses device domains, and stitches related telemetry sensors (e.g., dishwasher program progress, oven cavity lamps, vacuum docking status) into unified device objects.
> - **Real-Time Push**: The browser establishes a direct WebSocket connection (`wss://<nabu-casa-host>/api/websocket`) to Home Assistant Cloud and subscribes to `state_changed` events.
> - **Result**: Zero polling overhead, sub-50ms latency for physical wall switches, live timers, and sensor updates reflected immediately in XR.

---

## Detailed Components

### 1. Configuration & Multi-User Security Setup
- **Multi-User Google Authentication**: Client uses Firebase Auth with GoogleAuthProvider to authenticate users (`auth.js`).
- **User-Isolated Storage & Security Rules**:
  - Credentials and configurations (`geminiKey`, `haToken`, `haUrl`/`nabuCasaUrl`) are stored under `users/{uid}/config`.
  - Firebase Realtime Database and Firestore enforce rules such that only the user with `auth.uid === $uid` can read or write their credentials and pairings.
  - This ensures complete multi-user isolation: User A cannot read or modify User B's Gemini Key, Home Assistant API Key, or device pairings.
- **Dynamic In-UI Key Prompt**:
  - The configuration overlay allows users to sign in with Google, enter their Gemini API Key, Home Assistant Long-Lived Access Token, and Nabu Casa URL.
  - When saved, credentials are bound to the authenticated user's ID, loaded into the active session, and remembered for that user.
- **Fallback / Headset Auto-Load (`getConfig`)**:
  - For headless or shared kiosk environments, default configuration can still be preloaded via environment variables if desired.

### 2. Backend & Persistence Integration (`functions/index.js`, `services/firebase-ha-integration.js`)
- **`getConfig`**: Returns project ID and public configuration.
- **Per-User Spatial Anchor Persistence**:
  - `saveDeviceAnchor(anchorData, userId)`: Stores 3D anchors under user-scoped path (`users/{userId}/anchors/{anchorId}`).
  - `getSavedAnchors(userId)`: Fetches spatial anchors specifically mapped by the active authenticated user.
  - `deleteDeviceAnchor(entityId, userId)`: Deletes an anchor exclusively for the active user.
  - `resetAllAnchors(userId)`: Wipes anchors only for the active user, never touching other users' smart home configurations.
- **`getHaDevices` & `controlHaDevice`**: Supports user-provided `haUrl` and `haToken` to query and control each user's unique Home Assistant instance.

### 3. Client WebSocket Event Bus (`services/firebase-ha-integration.js`)
- **`connectWebSocket(haUrl, haToken)`**:
  - Establishes a connection to `wss://<ha_host>/api/websocket`.
  - Handles the authentication handshake (`auth_required` -> `auth` -> `auth_ok`).
  - Sends `subscribe_events` for `state_changed`.
  - Auto-reconnects with exponential backoff on network changes or sleep/wake cycles.
- **Event Dispatcher**:
  - Updates local entity attributes in the `devices` Map.
  - Matches child entity changes (e.g., `sensor.dishwasher_remaining_program_time`) to their parent compound appliance.
  - Emits `onEntityStateChanged(entityId, newState, parentDevice)` to update spatial cards.

### 4. XR Spatial Synchronization (`main.js`)
- **Initialization**:
  - Starts the WebSocket stream on boot via `apiConfig` from `getConfig`.
- **Reactive UI Cards (`VirtualLight3D`)**:
  - Whenever a `state_changed` event matches a paired device's `entity_id` or any of its `related` telemetry entities, the associated 3D spatial card updates its internal state and triggers `updateVisuals()`.
  - No flicker, no full DOM/group reconstruction—just instant, fluid telemetry updates (countdown timer ticks, light on/off state, temperature changes).

### 5. Spatial Mapping & Scanning Lifecycle
- **HUD Integration**:
  - Unmapped spatial anchors can be linked to any Home Assistant device from the stitched list.
  - Paired positions and rotations are saved directly to Firestore.
- **Ghost Elimination**:
  - Scanning resets and house-scale re-scans purge unmapped placeholders, retaining physical anchors.
