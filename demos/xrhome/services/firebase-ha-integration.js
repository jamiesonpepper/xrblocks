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
          this.devices.set(entity.entity_id, {
            id: entity.entity_id,
            name: entity.attributes.friendly_name || entity.entity_id,
            state: entity.state,
            attributes: entity.attributes,
            isOn: entity.state === 'on',
            brightness: entity.attributes.brightness ? Math.round((entity.attributes.brightness / 255) * 100) : 100
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
  
  async controlDevice(entity_id, service, service_data = {}) {
      try {
          const response = await fetch('https://us-central1-xrhome-009ef8.cloudfunctions.net/controlHaDevice', {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                  entity_id,
                  service,
                  service_data
              })
          });
          
          if (!response.ok) {
              const errText = await response.text();
              console.error("Control HA Device failed", errText);
              return false;
          }
          
          // Optimistically update local state
          const d = this.devices.get(entity_id);
          if (d) {
              if (service === 'turn_on') d.isOn = true;
              if (service === 'turn_off') d.isOn = false;
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
}
