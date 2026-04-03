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
    And the user selects an unmapped virtual spatial panel anchored to a physical light
    And the user assigns a specific Google Home Graph device to this spatial panel
    Then the Firebase Realtime Database should store this mapping associating the WebXR Anchor UUID to the Google Home Graph Device ID

  Scenario: Controlling a mapped device via Spatial Panel
    Given a virtual spatial panel is mapped to a Google Home Graph smart light
    When the user interacts with the spatial panel in XR to toggle the light "ON"
    Then the XR app should update the device state in the Firebase Realtime Database
    And a Firebase Cloud Function should trigger an Execute intent to the Google Home Graph API
    And the physical Google Home smart light should turn ON
    And the spatial panel should visually update to reflect the "ON" state

  Scenario: Automatically proposing device mappings based on proximity
    Given the system has access to the structural metadata (rooms) from the Google Home Graph
    When a new SLAM anchor is created in a specific mapped room
    Then the system should suggest unmapped Google Home Graph devices located in that same room
