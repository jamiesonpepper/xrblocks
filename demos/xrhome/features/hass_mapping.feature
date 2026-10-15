Feature: Home Assistant Cloud Device Mapping to SLAM Anchors
  As an XRBlocks user managing a smart home
  I want to link my physical Home Assistant Cloud devices to the spatially anchored virtual panels
  So that I can control my real-world smart lights using physical context and spatial UI

  Scenario: Authenticating with Firebase and Home Assistant Cloud
    Given the XR application is authenticated via Firebase Auth using Google credentials
    When the system queries the Firebase Realtime Database or Firestore under the authenticated user's ID
    Then it should receive a list of available smart home devices synchronized via the user's Home Assistant Cloud
    And the system should filter the list to identify controllable smart lights

  Scenario: Mapping SLAM-discovered lights to Home Assistant Cloud devices
    Given the house-scale SLAM scan has identified 3D light fixtures (Feature #1)
    And the system has retrieved the list of smart lights for the authenticated user
    When the user enters the "Device Mapping" mode in the XR app
    And the user selects an unmapped virtual spatial panel anchored to a physical light or smart home device
    And the user assigns a specific Home Assistant Cloud device to this spatial panel
    Then the Firebase Realtime Database or Firestore should store this mapping under the authenticated user's profile, associating the WebXR Anchor UUID to the Home Assistant Cloud Device ID
    And the spatial panel should visually update the label text to green to indicate it is mapped
    And the spatial panel should be locked in position and the label text should be automatically updated to use the official device name synced from Home Assistant Cloud.

  Scenario: Controlling power for a mapped device via Spatial Panel
    Given a virtual spatial panel is mapped to a Home Assistant Cloud smart light or smart home device
    When the user interacts with the spatial panel in XR to toggle the light "ON"
    Then the XR app should update the device state in the Firebase Realtime Database
    And a Firebase Cloud Function should trigger an Execute intent to the Home Assistant Cloud API
    And the physical Home Assistant Cloud smart light or smart home device should turn ON
    And the spatial panel should visually update to reflect the "ON" state

  Scenario: Controlling brightness for a mapped device via Spatial Panel
    Given a virtual spatial panel is mapped to a Home Assistant Cloud smart light
    When the user interacts with the spatial panel in XR using a + or - button to adjust the brightness of the light
    Then the XR app should update the device state in the Firebase Realtime Database
    And a Firebase Cloud Function should trigger an Execute intent to the Home Assistant Cloud API
    And the physical Home Assistant Cloud smart light should adjust its brightness

  Scenario: Controlling color for a mapped device via Spatial Panel
    Given a virtual spatial panel is mapped to a Home Assistant Cloud smart light
    When the user interacts with the spatial panel in XR to adjust the color of the light via a color wheel icon
    Then the XR app should update the device state in the Firebase Realtime Database
    And a Firebase Cloud Function should trigger an Execute intent to the Home Assistant Cloud API
    And the physical Home Assistant Cloud smart light should adjust its color
    And the spatial panel should visually update its label text to the same colour as the light

  Scenario: Automatically proposing device mappings based on proximity
    Given the system has access to the structural metadata (rooms) from the Home Assistant Cloud
    When a new SLAM anchor is created in a specific mapped room
    Then the system should suggest unmapped Home Assistant Cloud devices located in that same room

  Scenario: Handling offline states and Home Assistant Cloud sync failures
    Given a virtual spatial panel is mapped to a Home Assistant Cloud device
    When the user interacts with the spatial panel but the network request fails or times out
    Then the XR app should immediately display a localized error indicator on the spatial panel
    And the spatial panel state should revert to its previous visual configuration to ensure UI integrity

  Scenario: Querying for devices with an empty Home Assistant Cloud structure
    Given the user attempts to link a spatial panel via the plus button
    When the app queries the Home Assistant Cloud and no recognized devices are returned
    Then the spatial panel should display a meaningful "No Devices Found" empty state rather than a blank interface
    And provide an actionable prompt to ensure the user's devices are linked in the Home Assistant app

  Scenario: Cleaning up unmapped anchors when scanning stops
    Given the house-scale SLAM scan has identified multiple 3D light fixtures and created spatial panels
    When the user stops the "House Scan" session
    Then the system should evaluate all discovered virtual spatial panels
    And any spatial panel that has not been successfully mapped to a Home Assistant Cloud device should be discarded
    And the system should remove all unmapped anchor coordinates from the authenticated user's database records
    And only the coordinates of fully mapped devices for that user should be retained for future sessions

  Scenario: Mapping a spatial anchor directly to a multi-device lighting group
    Given the user has configured a common lighting group "Living Room Ceiling & Lamps" containing multiple bulbs and switches
    When the user selects an unmapped spatial anchor in the "Living Room"
    And assigns the lighting group "Living Room Ceiling & Lamps" to this anchor
    Then the spatial panel should bind to the lighting group UUID
    And the panel should update its friendly name to "Living Room Ceiling & Lamps"
    And controlling the anchor should dispatch synchronized commands to all member bulbs and switches

  Scenario: Newly mapped spatial panel defaults to condensed glanceable mode
    Given a spatial panel has just been successfully mapped to a device or group
    When the user finishes the mapping workflow and moves their pointer away
    Then the spatial panel should transition into condensed glanceable mode
    And display only the friendly name and current status badge until re-targeted by a pointer

