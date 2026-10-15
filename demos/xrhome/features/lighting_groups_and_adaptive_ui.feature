Feature: Spatial Lighting Groups, Selective Occlusion, Auxiliary Room Menu, and Adaptive Glanceable UI
  As an XRBlocks smart home user in an augmented or mixed reality environment
  I want to group lights and switches, filter out visual clutter using physical occlusion while keeping security devices visible, navigate all home devices via an auxiliary room menu, and see minimal glanceable telemetry that expands on proximity
  So that my spatial computing environment feels organized, responsive, uncluttered, and effortless to interact with

  Background:
    Given the XR application is authenticated via Firebase Auth
    And the user is connected to Home Assistant Cloud via WebSocket
    And the room-scale spatial anchor system is active with WebXR depth sensing enabled

  # =========================================================================
  # FEATURE 1: COMMON LIGHTING GROUPS (BULBS & SWITCHES)
  # =========================================================================

  @lighting_groups
  Scenario: Creating a new lighting group from multiple bulbs and switches in a room
    Given the user has discovered and mapped the following devices in "Living Room":
      | entity_id          | domain | type           | supports_brightness | supports_color |
      | light.ceiling_1    | light  | Smart Bulb     | true                | true           |
      | light.ceiling_2    | light  | Smart Bulb     | true                | true           |
      | switch.floor_lamp  | switch | Smart Plug     | false               | false          |
    When the user enters "Group Management" mode on the spatial card for "light.ceiling_1"
    And selects "Create New Lighting Group"
    And adds "light.ceiling_2" and "switch.floor_lamp" to the group
    And names the group "Living Room Ceiling & Lamps"
    Then a unified spatial lighting group card is created at the centroid position of the member devices
    And the group configuration is persisted under "users/{userId}/groups/group_living_room_ceiling_lamps" in Firestore
    And individual member spatial cards display a "Grouped" indicator badge linking to the master group

  @lighting_groups
  Scenario: Toggling master power on a heterogeneous lighting group
    Given an active lighting group "Living Room Ceiling & Lamps" containing:
      | entity_id          | domain | current_state |
      | light.ceiling_1    | light  | off           |
      | light.ceiling_2    | light  | off           |
      | switch.floor_lamp  | switch | off           |
    When the user presses the power toggle button on the group spatial card to turn the group "ON"
    Then the client dispatches Home Assistant service "light.turn_on" for "light.ceiling_1" and "light.ceiling_2"
    And the client dispatches Home Assistant service "switch.turn_on" for "switch.floor_lamp"
    And all member entities update their optimistic visual state to "ON"
    And the group card status badge updates to "3 of 3 ON"

  @lighting_groups
  Scenario: Adjusting brightness and color temperature across a heterogeneous lighting group
    Given an active lighting group "Living Room Ceiling & Lamps" where all devices are "ON"
    When the user adjusts the group brightness slider to "65%"
    Then the client dispatches Home Assistant service "light.turn_on" with brightness "166" for "light.ceiling_1" and "light.ceiling_2"
    And the client bypasses brightness payload for "switch.floor_lamp" while preserving its "ON" state
    When the user selects the "Warm White (2700K)" preset on the group card
    Then the client dispatches Home Assistant service "light.turn_on" with color_temp "370" for "light.ceiling_1" and "light.ceiling_2"
    And the group card displays an aggregate brightness badge of "65%" and color temperature of "2700K"

  @lighting_groups
  Scenario: Synchronizing group state when an individual member is toggled externally
    Given an active lighting group "Living Room Ceiling & Lamps" with 3 member devices all currently "ON"
    When a physical wall switch turns "switch.floor_lamp" to "off"
    And a WebSocket "state_changed" event is received for "switch.floor_lamp" with state "off"
    Then the lighting group card updates its status badge to "2 of 3 ON"
    And the group power toggle remains active in a partial-on state
    When both "light.ceiling_1" and "light.ceiling_2" are turned "off" via external automation
    Then the group card automatically updates its master power toggle to "OFF"

  @lighting_groups
  Scenario: Removing a device from an existing lighting group
    Given an active lighting group "Living Room Ceiling & Lamps" containing 3 devices
    When the user opens group settings and unchecks "switch.floor_lamp"
    Then "switch.floor_lamp" is detached from the group in Firestore
    And "switch.floor_lamp" restores its standalone spatial card representation
    And the lighting group updates its member count to 2 devices

  # =========================================================================
  # FEATURE 2: SELECTIVE OCCLUSION & PERIMETER SECURITY PASS-THROUGH
  # =========================================================================

  @occlusion
  Scenario: Standard device cards are hidden when occluded by physical room geometry
    Given the user is standing in the "Living Room"
    And a physical drywall partition separates the "Living Room" from the "Kitchen"
    And the following spatial cards are mapped in the "Kitchen":
      | entity_id              | domain        | category    |
      | light.kitchen_island   | light         | light       |
      | switch.coffee_maker    | switch        | switch      |
      | climate.main_thermostat| climate       | thermostat  |
      | vacuum.cleaner_dock    | vacuum        | vacuum      |
      | appliance.dishwasher   | dishwasher    | dishwasher  |
    When the system performs a line-of-sight raycast from the headset camera to the card anchors against the WebXR depth mesh
    Then the raycast detects an intersection with the intervening drywall plane
    And all 5 kitchen cards are set to "visible = false"
    And interaction raycasts for these occluded cards are ignored to prevent phantom clicks through walls

  @occlusion @security_passthrough
  Scenario: Door locks remain unoccluded and visible through physical walls
    Given the user is standing in the "Living Room"
    And the "Front Door Deadbolt" ("lock.front_door") is physically located in the "Entryway" behind an opaque wall
    When the system evaluates spatial occlusion for all registered cards
    Then the system identifies "lock.front_door" as having domain "lock"
    And the system bypasses line-of-sight hiding for the lock card
    And the lock card remains rendered in the user's field of view
    And the lock card displays an illuminated security beacon outline indicating pass-through mode
    And the user can see the current deadbolt status ("LOCKED") from the "Living Room"

  @occlusion @security_passthrough
  Scenario: Garage doors and motorized covers remain unoccluded and visible through physical walls
    Given the user is standing in the "Master Bedroom" on the second floor
    And the "Main Garage Door" ("cover.garage_door") is physically located on the ground floor
    When the system evaluates spatial occlusion for all registered cards
    Then the system identifies "cover.garage_door" as having domain "cover"
    And the system bypasses line-of-sight hiding for the cover card
    And the garage door card remains visible through ceilings and interior walls
    And the card displays real-time state badge "CLOSED" with perimeter security styling

  @occlusion @security_passthrough @gaze_summon
  Scenario: Glancing at a distant pass-through lock card dissolves and summons it into active FoV
    Given the user is standing in the "Living Room"
    And the "Front Door Deadbolt" ("lock.front_door") is visible through a wall at its distant physical anchor in the "Entryway"
    When the user fixes their gaze or reticle on the distant lock card for longer than 2 seconds
    Then a circular gaze dwell progress indicator completes around the security beacon
    And the distant lock card dissolves at its physical anchor with a smooth fade effect
    And reappears directly in the user's active Field of View at an ergonomic distance of 1.1 meters
    And expands into full interactive control mode displaying lock/unlock action buttons
    When the user taps the "Unlock" button on the summoned card
    Then the system dispatches Home Assistant service "lock.unlock"
    And the physical deadbolt unlocks

  @occlusion @security_passthrough @gaze_summon
  Scenario: Glancing at a distant pass-through cover card dissolves and summons it into active FoV
    Given the user is standing in the "Master Bedroom" on the second floor
    And the "Main Garage Door" ("cover.garage_door") is visible through the floor at its physical ground-floor anchor
    When the user fixes their gaze or reticle on the distant garage door card for longer than 2 seconds
    Then the distant garage door card dissolves at its physical ground-floor position
    And reappears floating directly in the user's active Field of View at chest level
    And displays interactive controls for "OPEN", "CLOSE", and "STOP"
    When the user finishes interacting and clicks "Dismiss" or looks away for 8 seconds
    Then the summoned card dissolves from the active FoV
    And reappears at its original physical 3D anchor position at the garage door

  @occlusion
  Scenario: Smooth transition when walking into line-of-sight of an occluded device
    Given a smart light card "light.kitchen_island" is currently occluded and invisible while user is in the "Living Room"
    When the user walks through the doorway into the "Kitchen"
    And the line-of-sight raycast between the headset camera and the card anchor becomes unobstructed
    Then the card smoothly fades in over 150ms
    And interactive controls are re-enabled without geometric pop or position jump

  # =========================================================================
  # FEATURE 3: AUXILIARY ROOM / AREA UNIFIED SELECTOR & CONTROL MENU
  # =========================================================================

  @auxiliary_menu
  Scenario: Opening the auxiliary room control menu from the HUD
    Given the user is in an active XRHome session
    When the user clicks the "All Devices" button on the primary 3D HUD
    Then a floating Auxiliary Room Control panel opens 1.2 meters directly in front of the user at chest level
    And the panel loads all synchronized devices grouped by their Home Assistant "Area" (e.g. Living Room, Kitchen, Garage, Master Bedroom)
    And each area header displays the area name along with count of active devices

  @auxiliary_menu
  Scenario: Toggling area-wide master controls from the auxiliary menu
    Given the auxiliary menu is open showing "Living Room" with 4 lights and 1 switch
    When the user clicks the "Turn Off All Lights" button on the "Living Room" area header
    Then the system sends batch turn-off commands to all lighting entities in the "Living Room"
    And all corresponding spatial cards in the room update immediately to the "OFF" state
    And the area header badge updates to "0 of 5 active"

  @auxiliary_menu
  Scenario: Controlling a single device directly within the auxiliary menu
    Given the auxiliary menu is open and expanded to the "Kitchen" area
    When the user clicks the inline toggle button next to "Kitchen Dishwasher"
    Then the system executes the corresponding Home Assistant service
    And the inline row updates its telemetry badge to "Cleaning (42m remaining)"
    And the physical 3D spatial card for the dishwasher updates synchronously in the 3D scene

  @auxiliary_menu
  Scenario: Locating a physical device in the room using the auxiliary menu beacon
    Given the user is looking at the auxiliary menu
    When the user clicks the "Locate" button next to "light.reading_nook_lamp"
    Then the auxiliary menu projects a temporary directional tracer beam towards the 3D coordinates of the reading nook lamp
    And the spatial card of the target lamp pulses with an accented highlight ring for 3 seconds
    And if the lamp card was occluded, it temporarily reveals itself through walls for the duration of the locate highlight

  # =========================================================================
  # FEATURE 4: CONDENSED GLANCEABLE UI & PROXIMITY-TRIGGERED EXPANSION
  # =========================================================================

  @adaptive_ui @condensed_card
  Scenario: Resting state of paired spatial card displays condensed glanceable telemetry
    Given a smart light "light.living_room_accent" is paired and positioned in the room
    And no controller ray, hand pointer, or user gaze reticle is targeting the card
    Then the spatial card renders in "Condensed Glanceable" mode
    And the card displays a compact capsule layout with:
      | element       | appearance                          |
      | Category Icon | Lightbulb icon                      |
      | Name Label    | "Living Room Accent"                |
      | Status Value  | "ON • 75% Brightness • 2700K"       |
    And the card omits all sliders, adjustment buttons, unpair buttons, and configuration controls
    And the card dimensions are reduced to 0.24m width by 0.08m height

  @adaptive_ui @proximity_expansion
  Scenario: Expanding card to full interactive controls upon pointer proximity
    Given a smart light card is in condensed glanceable mode
    When the user points an XR controller ray within 0.25 meters of the card
    Then the card transitions smoothly from condensed mode to "Expanded Interactive" mode over 200ms
    And the card expands to 0.36m width and dynamic height
    And reveals interactive controls:
      | control                     | function                                      |
      | Power Toggle Button         | Instant On/Off toggle                         |
      | Brightness Slider           | 1-100% fine adjustment                        |
      | Rainbow Color Slider & Swatch| 0-360 hue adjustment with live swatch        |
      | White Temperature Presets   | 6 preset buttons (2000K to 6500K)             |
      | Unpair Button               | Link removal action                           |

  @adaptive_ui @proximity_collapse
  Scenario: Collapsing card back to condensed mode when pointer leaves proximity
    Given a smart light card is in expanded interactive mode
    When the user moves the controller ray beyond 0.40 meters away from the card
    And the user is not actively manipulating any slider or dragging the card
    Then a 600ms hysteresis timer begins
    And upon timer expiration, the card transitions back to "Condensed Glanceable" mode
    And all sliders and secondary buttons are hidden from view

  @adaptive_ui @grace_period
  Scenario: Preserving expanded mode during active slider interaction
    Given a smart light card is in expanded interactive mode
    When the user drags the brightness slider and the controller ray temporarily drifts outside the card boundary
    Then the system detects an active interaction in progress
    And suppresses the collapse transition until the user releases the slider and the hysteresis timer expires

  # =========================================================================
  # FEATURE 5: POSITION LOCKING & GAZE/PROXIMITY MULTI-MODAL ACTIVATION
  # =========================================================================

  @lighting_groups @position_lock
  Scenario: Locking and unlocking group card position in 3D space
    Given an active lighting group card spawned in the room
    When the user clicks the "Unlocked" position toggle button with "lock_open" icon
    Then the group card position becomes locked in world space
    And the button updates to "Locked" with a "lock" icon in monochrome white styling
    And the card manipulation and raycast dragging are disabled
    And the lock state is persisted to the group anchor in Firestore
    When the user adds a new device to the group via "+ Group"
    Then the group card remains anchored at its current world-space coordinates without resetting to spawn

  @adaptive_ui @gaze_and_proximity_multimodal
  Scenario: Activating compact card via pointer reticle, 2-second gaze dwell, or physical proximity
    Given a device card in condensed glanceable mode
    When any of the following interaction triggers occurs:
      | trigger_modality     | condition                                                          |
      | Pointer Reticle      | Controller ray or hand reticle hovers over the compact capsule      |
      | Gaze Dwell           | Headset gaze remains within 18-degree central cone for 2.0 seconds |
      | Physical Proximity   | User head is within 1.35m or controller hand is within 0.70m       |
    Then the card immediately expands to full interactive mode
    And all button icons, borders, and badges are styled with clean monochrome white glassmorphism

