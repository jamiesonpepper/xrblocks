export class FirebaseHAIntegration {
  constructor(appId = 'xrhome-009ef8') {
    this.appId = appId;
    this.devices = new Map();
    this.onDevicesChanged = null;
    
    // We will simulate a listener that periodically fetches devices or relies on manual refresh
    this.pollInterval = null;
  }

  async listen() {
    // In a real Home Assistant integration, this would open a WebSocket.
    // For now, we'll do an initial fetch.
    await this.refreshDevices();
    return true;
  }

  async refreshDevices() {
    try {
      const response = await fetch('https://us-central1-xrhome-009ef8.cloudfunctions.net/getHaDevices');
      if (!response.ok) throw new Error("Failed to fetch HA devices");
      
      const data = await response.json();
      
      this.devices.clear();
      if (data.devices) {
        data.devices.forEach(entity => {
          const domain = entity.domain || entity.entity_id.split('.')[0];
          const battery = entity.attributes?.battery_level !== undefined ? entity.attributes.battery_level : (entity.attributes?.battery !== undefined ? entity.attributes.battery : null);
          this.devices.set(entity.entity_id, {
            id: entity.entity_id,
            domain: domain,
            name: entity.attributes?.friendly_name || entity.entity_id,
            area: entity.area || entity.attributes?.area || 'Other',
            state: entity.state,
            attributes: entity.attributes || {},
            isOn: entity.state === 'on' || entity.state === 'cleaning' || entity.state === 'locked' || entity.state === 'running',
            brightness: entity.attributes?.brightness ? Math.round((entity.attributes.brightness / 255) * 100) : 100,
            battery: battery,
            fanSpeed: entity.attributes?.fan_speed || null,
            related: entity.related || []
          });
        });
      }
      
      if (this.onDevicesChanged) {
        this.onDevicesChanged(this.devices);
      }
    } catch (e) {
      console.error("HA Refresh Error", e);
    }
  }

  async listDevices() {
    return Array.from(this.devices.values());
  }

  async getLightState(deviceId) {
    const d = this.devices.get(deviceId);
    return d ? !!d.isOn : false;
  }

  async toggleLight(deviceId, isOn) {
    return await this.controlDevice(deviceId, isOn ? 'turn_on' : 'turn_off');
  }

  async setBrightness(deviceId, brightness) {
    // Brightness is 0-100, HA expects 0-255
    const haBrightness = Math.round((brightness / 100) * 255);
    return await this.controlDevice(deviceId, 'turn_on', { brightness: haBrightness });
  }

  async setColor(deviceId, r, g, b) {
    return await this.controlDevice(deviceId, 'turn_on', { rgb_color: [r, g, b] });
  }

  async setColorTemp(deviceId, kelvin) {
    return await this.controlDevice(deviceId, 'turn_on', { color_temp_kelvin: kelvin });
  }

  // --- Lock Controls ---
  async controlLock(deviceId, action) {
    // action: 'lock' | 'unlock' | 'open'
    return await this.controlDevice(deviceId, action);
  }

  // --- Vacuum Controls & Station Commands ---
  async controlVacuum(deviceId, command, serviceData = {}) {
    // command: 'start' | 'pause' | 'stop' | 'return_to_base' | 'clean_spot' | 'locate'
    return await this.controlDevice(deviceId, command, serviceData);
  }

  async setVacuumFanSpeed(deviceId, fanSpeed) {
    return await this.controlDevice(deviceId, 'set_fan_speed', { fan_speed: fanSpeed });
  }

  async triggerVacuumDockEmpty(deviceId) {
    const d = this.devices.get(deviceId);
    const dockEntity = d?.attributes?.dock_empty_entity;
    return await this.controlDevice(deviceId, 'empty_dock', { dock_empty_entity: dockEntity }, 'vacuum');
  }

  async triggerVacuumMopWash(deviceId) {
    const d = this.devices.get(deviceId);
    if (d && d.related && d.related.length > 0) {
      const washBtn = d.related.find(r => r.domain === 'button' && (r.entity_id.includes('wash') || (r.name && r.name.toLowerCase().includes('wash'))));
      if (washBtn) {
        return await this.controlDevice(washBtn.entity_id, 'press');
      }
    }
    // Fallback to vacuum.send_command
    return await this.controlDevice(deviceId, 'send_command', { command: 'app_start_wash' });
  }

  // --- Appliance Controls ---
  async stopAppliance(deviceId) {
    return await this.controlDevice(deviceId, 'stop');
  }

  async toggleOvenLamp(deviceId, option = 'on', lampEntity = null) {
    return await this.controlDevice(deviceId, 'toggle_lamp', { option, lamp_entity: lampEntity });
  }

  // --- Switch / Generic Appliance Controls ---
  async toggleSwitch(deviceId, isOn) {
    return await this.controlDevice(deviceId, isOn ? 'turn_on' : 'turn_off');
  }
  
  async controlDevice(entity_id, service, service_data = {}, domain = null) {
      try {
          const payload = {
              entity_id,
              service,
              service_data
          };
          if (domain) payload.domain = domain;

          const response = await fetch('https://us-central1-xrhome-009ef8.cloudfunctions.net/controlHaDevice', {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify(payload)
          });
          
          if (!response.ok) {
              const errText = await response.text();
              console.error("Control HA Device failed", errText);
              return false;
          }

          const resData = await response.json().catch(() => ({}));
          if (resData && resData.success === false) {
              console.warn("HA Device control reported unsuccessful:", resData);
              return false;
          }
          
          // Optimistically update local state
          const d = this.devices.get(entity_id);
          if (d) {
              if (service === 'turn_on') { d.isOn = true; d.state = 'on'; }
              if (service === 'turn_off') { d.isOn = false; d.state = 'off'; }
              if (service === 'lock') { d.state = 'locked'; d.isOn = true; }
              if (service === 'unlock') { d.state = 'unlocked'; d.isOn = false; }
              if (service === 'start' || service === 'start_pause') { d.state = 'cleaning'; d.isOn = true; }
              if (service === 'pause') { d.state = 'paused'; }
              if (service === 'stop' || service === 'return_to_base') { d.state = 'returning'; }
              if (service === 'set_fan_speed' && service_data.fan_speed) { d.fanSpeed = service_data.fan_speed; }
              if (service_data.brightness !== undefined) {
                  d.brightness = Math.round((service_data.brightness / 255) * 100);
              }
          }
          return true;
      } catch (e) {
          console.error("HA Control Error", e);
          return false;
      }
  }

  // Pairing: Match the requested label to the closest HA device
  async commissionDevice(label) {
    console.log("Attempting to pair HA device matching label:", label);
    await this.refreshDevices();
    
    // Simple matching heuristic: check if friendly_name or entity_id includes the label
    const target = label.toLowerCase();
    
    let bestMatch = null;
    let fallbackMatch = null;
    
    for (const [id, device] of this.devices) {
        const name = device.name.toLowerCase();
        
        if (name === target) {
            bestMatch = id;
            break;
        }
        
        if (name.includes(target) || target.includes(name)) {
            bestMatch = id;
        }
        
        // Just grab any unassigned light as fallback if nothing matches
        if (!fallbackMatch && id.startsWith('light.')) {
            fallbackMatch = id;
        }
    }
    
    const pairedId = bestMatch || fallbackMatch;
    
    if (pairedId) {
        return { success: true, nodeId: pairedId, device: this.devices.get(pairedId) };
    }
    
    return { success: false, error: new Error("No matching HA device found") };
  }

  async unpairDevice(deviceId) {
    console.log("Unpairing HA device:", deviceId);
    return true;
  }

  // --- Anchor Persistence (Firestore) ---
  async getSavedAnchors() {
    try {
      const response = await fetch('https://us-central1-xrhome-009ef8.cloudfunctions.net/getAnchors');
      if (!response.ok) throw new Error("Failed to fetch saved anchors");
      const data = await response.json();
      return data.anchors || [];
    } catch (e) {
      console.error("Failed to get saved anchors:", e);
      return [];
    }
  }

  async saveDeviceAnchor(anchorData) {
    try {
      const response = await fetch('https://us-central1-xrhome-009ef8.cloudfunctions.net/saveAnchor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(anchorData)
      });
      if (!response.ok) throw new Error("Failed to save device anchor");
      const data = await response.json();
      return data.success;
    } catch (e) {
      console.error("Failed to save device anchor:", e);
      return false;
    }
  }

  async deleteDeviceAnchor(entityId) {
    try {
      const response = await fetch('https://us-central1-xrhome-009ef8.cloudfunctions.net/deleteAnchor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_id: entityId })
      });
      if (!response.ok) throw new Error("Failed to delete device anchor");
      const data = await response.json();
      return data.success;
    } catch (e) {
      console.error("Failed to delete device anchor:", e);
      return false;
    }
  }

  async resetAllAnchors() {
    try {
      const response = await fetch('https://us-central1-xrhome-009ef8.cloudfunctions.net/resetAnchors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) throw new Error("Failed to reset anchors");
      const data = await response.json();
      return data.success;
    } catch (e) {
      console.error("Failed to reset anchors:", e);
      return false;
    }
  }
}
