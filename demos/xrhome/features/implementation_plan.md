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

### 1. Configuration & Security Setup
- **`functions/.env`**: Stores `HA_URL` (e.g., `https://<id>.ui.nabu.casa`) and `HA_TOKEN` (Long-Lived Access Token).
- **`getConfig` Cloud Function**: Securely supplies the necessary connection endpoints and tokens to authenticated headset/browser client sessions so manual token entry on headset virtual keyboards is unnecessary.

### 2. Backend Integration (`functions/index.js`)
- **`getConfig`**: Returns runtime configuration (`haUrl`, `haToken`, `geminiKey`, `firebaseApiKey`).
- **`getHaDevices`**: Aggregates raw Home Assistant entities across domains (`light`, `switch`, `vacuum`, `climate`, `water_heater`, `sensor`, `binary_sensor`) into compound appliances with friendly names, areas, and related telemetry.
- **`controlHaDevice`**: Handles command execution with validation and graceful error reporting (`{ success, controllable, error }`).
- **Spatial Anchors**: Manages 3D world poses in native Firestore (`saveAnchor`, `getAnchors`, `deleteAnchor`, `resetAnchors`).

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
