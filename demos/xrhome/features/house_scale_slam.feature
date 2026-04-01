Feature: House-Scale SLAM Scanning and Storage via WebXR Anchors
  As a user with a WebXR-compatible device
  I want to scan and store the physical layout of my multi-floor house including light fixtures
  So that I can persistently interact with virtual spatial panels anchored to physical entities

  Scenario: Initializing a house-scale scanning session
    Given the user grants camera and spatial tracking permissions
    When the user starts a "House Scan" session in the XRBlocks application
    Then the system should establish an "unbounded" WebXR reference space
    And the system should begin plane detection for floors, walls, and ceilings

  Scenario: Discovering and semantically identifying light fixtures
    Given an active house-scale scanning session
    When the user looks at a physical light fixture on the ceiling
    Then the WebXR Lighting Estimation API should detect the primary light direction and intensity
    And the on-device ML vision model should identify the 2D bounding box as a "light fixture"
    And the system should correlate the 2D bounding box with the 3D ceiling plane depth data
    And project a virtual spatial panel indicator at the fixture's 3D coordinates

  Scenario: Persisting anchors across a multi-floor environment
    Given the system has identified multiple light fixtures across different rooms
    When the system creates an XRHitTestResult anchor for each fixture
    Then the system should request a persistent handle (UUID) for the room's Master Anchor
    And the system should store the relative (X, Y, Z) coordinates of each light fixture in IndexedDB
    And the system should handle tracking drift by using SLAM loop closure when the user re-enters a mapped room

  Scenario: Handling tracking loss and recovery
    Given an active scanning session traversing between floors
    When the device loses spatial tracking and fires an "onreset" event
    Then the system should pause the anchoring process
    And wait for SLAM relocalization
    And restore the Master Anchor from the persistent handle to resynchronize the unbounded coordinate system
