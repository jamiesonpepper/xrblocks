Feature: Google Home Device Mapping to SLAM Anchors
  As an XRBlocks user managing a smart home
  I want to link my physical Google Home devices to the spatially anchored virtual panels
  So that I can control my real-world smart lights using physical context and spatial UI

  Scenario: Authenticating with Firebase and Google Home Graph
    Given the XR application is authenticated via Firebase Auth
    When the system queries the Firebase Realtime Database for user devices
    Then it should receive a list of available smart home devices synchronized via Google Home Graph
    And the system should filter the list to identify controllable smart lights

  Scenario: Mapping SLAM-discovered lights to Google Home Graph devices
    Given the house-scale SLAM scan has identified 3D light fixtures (Feature #1)
    And the system has retrieved the list of smart lights from Firebase
    When the user enters the "Device Mapping" mode in the XR app
    And the user selects an unmapped virtual spatial panel anchored to a physical light or smart home device
    And the user assigns a specific Google Home Graph device to this spatial panel
    Then the Firebase Realtime Database should store this mapping associating the WebXR Anchor UUID to the Google Home Graph Device ID
    And the spatial panel should visually update the label text to green to indicate it is mapped
    And the spatial panel should be locked in position and the label text should be automatically updated to use the official device name synced from Google Home.

  Scenario: Controlling power for a mapped device via Spatial Panel
    Given a virtual spatial panel is mapped to a Google Home Graph smart light or smart home device
    When the user interacts with the spatial panel in XR to toggle the light "ON"
    Then the XR app should update the device state in the Firebase Realtime Database
    And a Firebase Cloud Function should trigger an Execute intent to the Google Home Graph API
    And the physical Google Home smart light or smart home device should turn ON
    And the spatial panel should visually update to reflect the "ON" state

  Scenario: Controlling brightness for a mapped device via Spatial Panel
    Given a virtual spatial panel is mapped to a Google Home Graph smart light
    When the user interacts with the spatial panel in XR using a + or - button to adjust the brightness of the light
    Then the XR app should update the device state in the Firebase Realtime Database
    And a Firebase Cloud Function should trigger an Execute intent to the Google Home Graph API
    And the physical Google Home smart light should adjust its brightness

  Scenario: Controlling color for a mapped device via Spatial Panel
    Given a virtual spatial panel is mapped to a Google Home Graph smart light
    When the user interacts with the spatial panel in XR to adjust the color of the light via a color wheel icon
    Then the XR app should update the device state in the Firebase Realtime Database
    And a Firebase Cloud Function should trigger an Execute intent to the Google Home Graph API
    And the physical Google Home smart light should adjust its color
    And the spatial panel should visually update its label text to the same colour as the light

  Scenario: Automatically proposing device mappings based on proximity
    Given the system has access to the structural metadata (rooms) from the Google Home Graph
    When a new SLAM anchor is created in a specific mapped room
    Then the system should suggest unmapped Google Home Graph devices located in that same room

  Scenario: Handling offline states and Home Graph sync failures
    Given a virtual spatial panel is mapped to a Google Home Graph device
    When the user interacts with the spatial panel but the network request fails or times out
    Then the XR app should immediately display a localized error indicator on the spatial panel
    And the spatial panel state should revert to its previous visual configuration to ensure UI integrity

  Scenario: Querying for devices with an empty Home Graph structure
    Given the user attempts to link a spatial panel via the plus button
    When the app queries the Home Graph and no recognized devices are returned
    Then the spatial panel should display a meaningful "No Devices Found" empty state rather than a blank interface
    And provide an actionable prompt to ensure the user's devices are linked in the Google Home app
