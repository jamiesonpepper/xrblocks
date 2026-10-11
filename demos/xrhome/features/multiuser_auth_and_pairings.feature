Feature: Multi-User Google Authentication, Dynamic Key Provisioning, and Isolated Home Assistant Pairings
  As an XRBlocks XRHome user
  I want to sign in with my Google credentials, input my Gemini API Key, Home Assistant API Key, and Nabu Casa Key from the UI, and have them stored securely under my user profile
  So that multiple users can independently manage their own smart home pairings and spatial anchors with strict security isolation

  Background:
    Given the XRHome application is loaded in the browser or WebXR headset
    And the Firebase client SDK is initialized with the project configuration

  Scenario: Authenticating with Google credentials via the UI prompt
    Given the user opens the XRHome configuration overlay
    When the user clicks the "Sign in with Google" button
    And completes the Google OAuth authentication popup
    Then the user should be authenticated with their unique Google UID
    And the configuration UI should display the user's profile information and sign-out option
    And the configuration UI should enable the credential input fields

  Scenario: Prompting and storing Gemini API Key, HA API Key, and Nabu Casa Key under the authenticated user
    Given the user is authenticated with Google credentials with UID "user_alice_123"
    When the user enters their Gemini API Key "AIzaSy_Alice_Gemini_Key" in the UI prompt
    And the user enters their Home Assistant Long-Lived Access Token "ha_token_alice_abc123" in the UI prompt
    And the user enters their Home Assistant Nabu Casa URL "https://alice123.ui.nabu.casa" in the UI prompt
    And the user submits the configuration form
    Then the system should encrypt or store these credentials under the Realtime Database / Firestore path "users/user_alice_123/config"
    And the stored record should associate the keys directly with "user_alice_123"
    And the XRHome application should initialize Gemini Vision with Alice's Gemini API key
    And the XRHome application should establish a real-time WebSocket connection to Alice's Nabu Casa URL

  Scenario: Enforcing strict access control and isolation for stored API keys
    Given User Alice with UID "user_alice_123" has stored her Gemini API Key and HA Key in Firebase
    When User Bob with UID "user_bob_456" authenticates with his Google credentials
    Then Firebase security rules should prohibit User Bob from reading "users/user_alice_123/config"
    And Firebase security rules should prohibit User Bob from modifying "users/user_alice_123/config"
    And the XRHome UI for User Bob should only display User Bob's own credentials or blank inputs if unconfigured
    And only User Alice can retrieve or update the Gemini API Key that Alice entered

  Scenario: Storing spatial Home Assistant device pairings under the authenticated user profile
    Given User Alice is authenticated with UID "user_alice_123"
    And Alice's Home Assistant instance has retrieved smart home devices
    When Alice identifies a physical smart lamp in XR and maps it to Home Assistant entity "light.living_room_lamp"
    Then the 3D spatial anchor position and orientation should be saved under "users/user_alice_123/anchors/light.living_room_lamp"
    And the database record should contain the entity ID, device name, spatial coordinates, and rotation
    And the spatial anchor should not overwrite or pollute any global anchor collections

  Scenario: Multi-user isolation of device pairings and spatial anchors
    Given User Alice with UID "user_alice_123" has mapped "light.living_room_lamp" at position (0.5, 1.2, -1.8)
    And User Bob with UID "user_bob_456" has mapped "switch.workshop_bench" at position (-1.0, 0.9, -0.7)
    When User Alice launches an XRHome session
    Then Alice's session should only load spatial anchors from "users/user_alice_123/anchors"
    And Alice should see the 3D card for "light.living_room_lamp"
    And Alice should not see Bob's "switch.workshop_bench" card
    When User Bob launches an XRHome session
    Then Bob's session should only load spatial anchors from "users/user_bob_456/anchors"
    And Bob should see the 3D card for "switch.workshop_bench"
    And Bob should not see Alice's "light.living_room_lamp" card

  Scenario: Resetting spatial pairings scoped strictly to the active user
    Given User Alice is authenticated with UID "user_alice_123" with 3 mapped devices
    And User Bob is authenticated with UID "user_bob_456" with 2 mapped devices
    When User Alice triggers "Reset All Pairings" from the in-XR HUD
    Then only the anchors under "users/user_alice_123/anchors" should be removed
    And the anchors under "users/user_bob_456/anchors" should remain intact in Firebase
    And Bob's mapped devices should continue to function without interruption

  Scenario: Switching accounts preserves separate smart home configurations
    Given User Alice signs out of XRHome
    When User Bob signs in with his Google credentials
    Then XRHome should disconnect Alice's Home Assistant WebSocket
    And XRHome should clear Alice's spatial cards from the 3D scene
    And XRHome should load Bob's Gemini API Key and Nabu Casa credentials
    And XRHome should connect to Bob's Nabu Casa WebSocket
    And XRHome should restore Bob's spatial anchors in the scene
