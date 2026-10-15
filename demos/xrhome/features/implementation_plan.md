# Home Assistant Cloud WebSocket & Spatial Integration Plan

This document outlines the architecture and implementation for integrating Home Assistant Cloud (Nabu Casa) with XRHome using a **Hybrid Client WebSocket** architecture. This enables sub-millisecond, push-based real-time state telemetry (e.g., live countdowns, temperatures, toggles) directly on spatial UICards in AR/VR, while utilizing Firebase Cloud Functions for secure credential distribution, complex entity aggregation, and Firestore spatial anchor persistence.

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                        XRHome Browser / Quest                          │
│                                                                        │
│  1. Fetch initial stitched devices & 3D anchors                        │
│     via Cloud Functions (Secure / Cached)                              │
│                                                                        │
│  2. Open direct WebSocket to Nabu Casa:                                │
│     wss://<remote-id>.ui.nabu.casa/api/websocket                       │
│                                                                        │
│  3. Subscribe to "state_changed" push events                           │
│                                                                        │
│  ┌─────────────────────────┐         ┌───────────────────────────────┐ │
│  │ Spatial Lighting Groups │         │ Selective Occlusion Engine    │ │
│  │ - Heterogeneous Bulbs   │         │ - Raycast vs WebXR Depth Mesh │ │
│  │   & Wall Switches       │         │ - Security Pass-Through       │ │
│  │ - Centroid Master Anchor│         │   (Locks & Covers visible)    │ │
│  └─────────────────────────┘         └───────────────────────────────┘ │
│                                                                        │
│  ┌─────────────────────────┐         ┌───────────────────────────────┐ │
│  │ Auxiliary Room Menu     │         │ Adaptive Glanceable UI        │ │
│  │ - Area/Room Grouping    │         │ - Resting Condensed Capsule   │ │
│  │ - Batch Room Toggles    │         │ - Proximity Expansion (<0.35m)│ │
│  │ - 3D Tracer Locator     │         │ - Hysteresis Grace Debounce   │ │
│  └─────────────────────────┘         └───────────────────────────────┘ │
└───────────────────────┬─────────────────────────────▲──────────────────┘
                        │ (REST / Firestore)          │ (Direct WSS Push)
                        ▼                             │
┌───────────────────────────────────┐   ┌─────────────┴──────────────────┐
│ Firebase Cloud Functions          │   │ Home Assistant Cloud           │
│ & Firestore                       │   │ (Nabu Casa WebSocket)          │
│                                   │   │                                │
│ - Anchor & Group Persistence      │   │ - Instant 0ms state push       │
│ - Initial Stitched List & Areas   │   │ - Real-time countdowns & sync  │
└───────────────────────────────────┘   └────────────────────────────────┘
```

---

## Technical Decisions & Status

> [!NOTE]
> **API Decision: Hybrid Client WebSocket (RESOLVED)**
> - **Initial Aggregation**: Firebase Cloud Function `getHaDevices` fetches the entity list, parses device domains, and stitches related telemetry sensors (e.g., dishwasher program progress, oven cavity lamps, vacuum docking status) into unified device objects.
> - **Real-Time Push**: The browser establishes a direct WebSocket connection (`wss://<nabu-casa-host>/api/websocket`) to Home Assistant Cloud and subscribes to `state_changed` events.
> - **Result**: Zero polling overhead, sub-50ms latency for physical wall switches, live timers, and sensor updates reflected immediately in XR.

> [!NOTE]
> **Spatial Grouping: Heterogeneous Lighting Groups (NEW - RESOLVED)**
> - **Heterogeneous Coordination**: Allows grouping smart bulbs (`light.*`) and smart switches/plugs (`switch.*`) under a single logical lighting group card.
> - **Graceful Capability Mapping**: Power toggles apply to all member entities; brightness, hue, and color temperature commands are routed only to dimmable bulbs while preserving binary switch states.
> - **Centroid Anchoring**: The group spatial card is positioned at the geometric centroid of member device anchors or manually anchored.

> [!IMPORTANT]
> **Perception Decision: Selective Occlusion with Security Pass-Through (NEW - RESOLVED)**
> - **Line-of-Sight Occlusion**: Standard spatial cards (`light`, `switch`, `climate`, `appliance`, `vacuum`, `dishwasher`, `oven`, `litter_robot`) are hidden when physical walls or obstacles intersect the line-of-sight between headset and card.
> - **Perimeter Security Pass-Through**: **Door Locks** (`lock.*`) and **Garage Doors / Covers** (`cover.*`) are strictly exempted from occlusion. They remain rendered with an illuminated perimeter pass-through beacon through walls to ensure whole-home security awareness.

> [!TIP]
> **Ergonomics Decision: Auxiliary Room/Area Control Menu (NEW - RESOLVED)**
> - **Global Overview**: Provides a floating 3D dashboard categorized by Home Assistant Area Registry (e.g., Kitchen, Living Room, Exterior).
> - **Dual Control & Spatial Tracing**: Enables direct device interaction without navigating physically to each fixture, plus a "Locate in XR" directional tracer pointing directly to any device's 3D spatial anchor.

> [!TIP]
> **Minimalist Aesthetics: Condensed Glanceable Capsule with Proximity Expansion (NEW - RESOLVED)**
> - **Resting State**: Paired device cards render as minimalist glanceable capsules showing only friendly name and live telemetry values (no sliders or adjustment buttons).
> - **Proximity Trigger**: When an XR controller ray, hand pointer, or reticle enters proximity (<0.35m halo), the card smoothly expands over 200ms into the full interactive control card.
> - **Hysteresis Debounce**: A 600ms grace period prevents jittery collapsing when the pointer momentarily drifts off-target or while actively dragging sliders.

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
- **Per-User Lighting Group Persistence**:
  - `saveLightingGroup(groupData, userId)`: Persists lighting group definitions under `users/{userId}/groups/{groupId}` including member entity IDs, friendly name, area, and centroid coordinates.
  - `getLightingGroups(userId)`: Retrieves all configured lighting groups for initial session hydration.
  - `deleteLightingGroup(groupId, userId)`: Deletes group mapping while preserving underlying device anchors.
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
  - Triggers member re-calculation and badge refreshes on any parent lighting group.

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

### 6. Common Lighting Group Management (`services/group-manager.js`, `main.js`)
- **Heterogeneous Member Composition**:
  - Groups support any combination of smart bulbs (`light.*`), smart wall switches (`switch.*`), and smart plugs.
  - Data schema:
    ```json
    {
      "groupId": "group_living_room_ceiling",
      "name": "Living Room Ceiling & Lamps",
      "area": "Living Room",
      "members": [
        { "id": "light.ceiling_1", "domain": "light", "supportsBrightness": true, "supportsColor": true },
        { "id": "light.ceiling_2", "domain": "light", "supportsBrightness": true, "supportsColor": true },
        { "id": "switch.floor_lamp", "domain": "switch", "supportsBrightness": false, "supportsColor": false }
      ],
      "position": { "x": 0.5, "y": 2.2, "z": -1.8 },
      "quaternion": { "x": 0, "y": 0, "z": 0, "w": 1 }
    }
    ```
- **Command Orchestration**:
  - `toggleGroupPower(groupId, state)`:
    - Broadcasts `light.turn_on` / `light.turn_off` to bulbs and `switch.turn_on` / `switch.turn_off` to switches.
    - Emits optimistic batch updates to maintain fluid UI response.
  - `setGroupBrightness(groupId, value)`:
    - Transmits brightness payloads exclusively to dimmable bulbs.
    - Switches remain energized without throwing unsupported parameter errors.
  - `setGroupColor(groupId, r, g, b)` & `setGroupColorTemp(groupId, kelvin)`:
    - Targets only color-capable bulbs in the group.
- **Spatial UI Card Representation**:
  - Renders as a specialized `VirtualLightGroup3D` or designated group card.
  - Status display: "3 of 3 ON", aggregate brightness slider, group color picker.
  - Standalone cards belonging to a group display a linked indicator tag (`🔗 Grouped`).

### 7. Selective Line-of-Sight Occlusion with Security Pass-Through (`services/occlusion-manager.js`, `main.js`)
- **Occlusion Pipeline & Frequency**:
  - Uses WebXR Depth Mesh (`xb.core.depth.depthMesh`) and detected plane geometry.
  - Raycaster originates from headset camera world position $\mathbf{P}_{cam}$ to each card world position $\mathbf{P}_{card}$.
  - Staggered evaluation: Evaluates 5 cards per frame round-robin (eliminating 90fps GPU pipeline stalls).
- **Domain Exemption Policy**:
  - **Security Pass-Through (Exempt from Occlusion)**:
    - `domain === 'lock'` (deadbolts, electronic door latches).
    - `domain === 'cover'` or `category === 'garage_door'` (garage doors, exterior motorized shutters/covers).
    - Rendered with `depthTest: false` (or secondary render layer) and an ethereal outer glow, allowing the user to monitor entry security status from anywhere in the home.
  - **Standard Devices (Occlusion Enforced)**:
    - `light`, `switch`, `climate`, `vacuum`, `dishwasher`, `oven`, `litter_robot`, `media_player`.
    - If raycast encounters physical geometry between camera and card ($d_{hit} < d_{card} - 0.15\text{m}$), the card visibility is toggled `false`.
    - Raycast interaction targets are disabled when occluded to prevent accidental ray selection through walls.
- **Visual Transitions**:
  - 150ms opacity tween when transitioning across line-of-sight boundaries to eliminate harsh geometric pops.
- **Glance-to-Summon Active FoV Recall (Dwell Duration > 2.0s)**:
  - **Interaction Mechanic**: When a user looks directly at a distant pass-through lock or cover card through walls/ceilings, a subtle circular gaze dwell progress meter activates around the beacon outline.
  - **Dissolve & Summon**: If gaze/reticle dwell exceeds 2.0 seconds:
    - The distant card smoothly dissolves at its physical anchor location using an alpha/particle fade out (250ms).
    - It immediately reappears floating directly in the user's active Field of View (1.1m in front of the camera at chest level, matching HUD ergonomics).
    - The summoned card automatically expands into full interactive control mode (displaying large Lock/Unlock or Open/Close/Stop buttons).
  - **Dismissal & Return Lifecycle**:
    - Tapping "Dismiss", performing the security command, or looking away for 8 seconds triggers a smooth dissolve from the active FoV.
    - The card fades back in at its original 3D anchor position at the physical door or garage opening.

### 8. Auxiliary Room/Area Device Control Menu (`components/auxiliary-room-menu.js`, `hud.js`)
- **Access & Placement**:
  - Summoned via HUD button ("🏠 All Devices"), controller shortcut (`B` / `Y` button), or palm/wrist tap.
  - Spawns at 1.2m distance directly in front of the user at chest level, with billboard rotation.
- **Hierarchical Layout**:
  - **Area Tabs / Accordion**: Populated dynamically from Home Assistant Area Registry.
  - **Area Header Master Controls**: "All Off" button, active device counter (e.g. `Living Room (4 active)`).
  - **Device List Row Items**:
    - Domain icon, friendly device name, current status readout (`ON`, `OFF`, `LOCKED`, `CLEANING`).
    - Inline mini-controls: Quick power toggle, lock toggle, garage door trigger.
    - **"Locate in XR" Action**:
      - Emits a visual 3D tracer beam from the auxiliary menu towards the device's physical anchor in the room.
      - Triggers an animated accent pulse on the target device's spatial card.
      - Temporarily reveals the target card through walls if occluded.

### 9. Adaptive Glanceable UI & Proximity Expansion (`components/adaptive-card-renderer.js`, `main.js`)
- **Two-Tier Visual Architecture**:
  1. **Tier 1: Condensed Glanceable Capsule (Default Resting State)**:
     - Sleek, compact glassmorphic capsule (~0.24m wide by ~0.08m high).
     - Displays only:
       - Category / Domain Icon.
       - Device Friendly Name.
       - Primary Telemetry Badge:
         - Light: `💡 On (75%) • 2700K` or `Off`.
         - Switch: `🔌 On` or `Off`.
         - Lock: `🔒 Locked` (or `🔓 Unlocked`).
         - Cover: `🚪 Closed` / `Open`.
         - Climate: `🌡️ 72°F (Target: 70°F)`.
         - Dishwasher: `🍽️ Washing (34m left)`.
         - Oven: `🍳 375°F (15m left)`.
         - Vacuum: `🧹 Docked (100%)`.
     - Zero sliders, large buttons, or unpair controls.
  2. **Tier 2: Expanded Interactive Control Card**:
     - Standard full-size card layout (0.36m wide, dynamic height).
     - Renders all sliders, temperature presets, color wheels, and config buttons.
- **Proximity Detection & Trigger Mechanics**:
  - Evaluated per frame in `HUDInteraction`:
    - Controller ray distance to card center $d_{ray} < 0.25\text{m}$, OR
    - Physical controller/hand proximity distance $d_{hand} < 0.45\text{m}$.
  - Expansion occurs via smooth 200ms lerp.
- **Hysteresis & Interaction Lock**:
  - **Grace Debounce (600ms)**: When the pointer exits the proximity radius, a 600ms grace timer starts before triggering collapse.
  - **Interaction Lock**: While the user is actively dragging a slider (`isDraggingSlider = true`) or holding a button, collapse is strictly suppressed regardless of ray direction until released.

### 10. Position Locking, Multi-modal Activation, and Monochrome Glassmorphic Styling
- **Group Position Locking**:
  - Adds a dedicated `Locked` / `Unlocked` toggle button pairing (`lock` / `lock_open` icon) to the Lighting Group UICard.
  - Toggling `Locked` disables raycast dragging and manipulation, preserving world coordinates.
  - When new devices are added via `+ Group`, live 3D coordinates from `grpCard.position` are synchronized before Firestore persistence, preventing cards from jumping back to spawn coordinates.
- **Group Command Fan-Out**:
  - `toggle()`, `setBrightness()`, `setColor()`, and `setColorTemp()` immediately broadcast to Home Assistant service APIs and update all member `VirtualLight3D` instances in the active 3D scene synchronously.
- **Multi-Modal Compact Card Expansion**:
  - **Pointer Reticle Hover**: Instant expansion upon controller ray or hand pointer entering card bounds.
  - **Physical Proximity Fallback**: Instant expansion when head distance $< 1.35\text{m}$ or controller hand $< 0.70\text{m}$.
  - **2-Second Gaze Dwell**: Sustained head focus within an $18^\circ$ central visual cone accumulates a 2.0s dwell timer with gentle decay, expanding cards at distances up to $4.5\text{m}$.
- **Monochrome Glassmorphic Design**:
  - All button backgrounds, borders, icons, tracer highlights, and badges are standardized to pure white (`#FFFFFF`, `rgba(255, 255, 255, 0.16)`, hover `rgba(255, 255, 255, 0.75)` with `#000000` text) to ensure visual elegance across XR passthrough.

