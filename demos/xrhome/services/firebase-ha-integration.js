export class FirebaseHAIntegration {
  constructor(appId = 'xrhome-009ef8') {
    this.appId = appId;
    this.devices = new Map();
    this.onDevicesChanged = null;
    this.onEntityStateChanged = null;
    
    // WebSocket state for real-time push updates
    this.ws = null;
    this.wsUrl = null;
    this.wsToken = null;
    this.wsMsgId = 1;
    this.wsReconnectTimer = null;
    this.wsConnected = false;
    this.reconnectAttempts = 0;
  }

  async listen(haUrl = null, haToken = null) {
    this.haUrl = haUrl;
    this.haToken = haToken;
    await this.refreshDevices();
    if (haUrl && haToken) {
      this.connectWebSocket(haUrl, haToken);
    }
    return true;
  }

  connectWebSocket(haUrl, haToken) {
    if (!haUrl || !haToken) {
      console.warn("[HA WebSocket] Missing haUrl or haToken, skipping WebSocket connection.");
      return;
    }

    let wsBase = haUrl.trim().replace(/^http/, 'ws').replace(/\/$/, '');
    if (!wsBase.endsWith('/api/websocket')) {
      wsBase += '/api/websocket';
    }
    this.wsUrl = wsBase;
    this.wsToken = haToken;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    console.log(`[HA WebSocket] Connecting to ${this.wsUrl}...`);
    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        console.log("[HA WebSocket] Socket opened, awaiting auth_required...");
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleWebSocketMessage(msg);
        } catch (err) {
          console.warn("[HA WebSocket] Failed to parse message:", event.data, err);
        }
      };

      this.ws.onerror = (err) => {
        console.warn("[HA WebSocket] Error:", err);
      };

      this.ws.onclose = (event) => {
        console.log(`[HA WebSocket] Connection closed (code: ${event.code}). Scheduling reconnect...`);
        this.wsConnected = false;
        this.scheduleWebSocketReconnect();
      };
    } catch (err) {
      console.error("[HA WebSocket] Initialization error:", err);
      this.scheduleWebSocketReconnect();
    }
  }

  disconnectWebSocket() {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
    this.wsConnected = false;
  }

  scheduleWebSocketReconnect() {
    if (this.wsReconnectTimer) return;
    this.reconnectAttempts++;
    const delay = Math.min(30000, Math.max(2000, 1000 * Math.pow(1.5, this.reconnectAttempts)));
    console.log(`[HA WebSocket] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})...`);
    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      if (this.wsUrl && this.wsToken) {
        this.connectWebSocket(this.wsUrl, this.wsToken);
      }
    }, delay);
  }

  handleWebSocketMessage(msg) {
    if (!msg || !msg.type) return;

    if (msg.type === 'auth_required') {
      console.log("[HA WebSocket] Auth required. Sending token...");
      this.ws.send(JSON.stringify({
        type: 'auth',
        access_token: this.wsToken
      }));
    } else if (msg.type === 'auth_ok') {
      console.log("[HA WebSocket] Authenticated successfully! Subscribing to state_changed events...");
      this.wsConnected = true;
      this.wsMsgId++;
      this.ws.send(JSON.stringify({
        id: this.wsMsgId,
        type: 'subscribe_events',
        event_type: 'state_changed'
      }));
    } else if (msg.type === 'auth_invalid') {
      console.error("[HA WebSocket] Authentication failed:", msg.message);
      this.wsConnected = false;
    } else if (msg.type === 'event' && msg.event?.event_type === 'state_changed') {
      const data = msg.event.data;
      if (!data) return;
      this.processStateChangedEvent(data.entity_id, data.new_state, data.old_state);
    }
  }

  processStateChangedEvent(entityId, newState, oldState) {
    if (!newState) return;
    let targetDevice = null;

    // 1. Direct device match
    if (this.devices.has(entityId)) {
      const d = this.devices.get(entityId);
      d.state = newState.state;
      d.attributes = { ...d.attributes, ...newState.attributes };
      d.isOn = ['on', 'cleaning', 'locked', 'running', 'lamp_on'].includes(newState.state);
      if (newState.attributes?.brightness !== undefined) {
        d.brightness = Math.round((newState.attributes.brightness / 255) * 100);
      }
      if (newState.attributes?.battery_level !== undefined) {
        d.battery = newState.attributes.battery_level;
      } else if (newState.attributes?.battery !== undefined) {
        d.battery = newState.attributes.battery;
      }
      if (newState.attributes?.fan_speed !== undefined) {
        d.fanSpeed = newState.attributes.fan_speed;
      }
      targetDevice = d;
    }

    // 2. Check if this entity is associated with a compound appliance (dishwasher, oven, vacuum station, etc.)
    for (const d of this.devices.values()) {
      let isRelated = false;
      const devId = (d.id || d.entity_id || '');
      const isDishwasher = d.domain === 'dishwasher' || devId.includes('dishwasher');
      const isOven = d.domain === 'oven' || devId.includes('oven');

      // Match via related list
      if (d.related && d.related.some(r => r.entity_id === entityId)) {
        isRelated = true;
      }

      // Match via specific attributes
      if (d.attributes?.lamp_entity === entityId) {
        d.attributes.lamp_state = newState.state;
        isRelated = true;
      }
      if (d.attributes?.countdown_entity === entityId || 
          entityId.includes('remaining_program_time') || 
          entityId.includes('program_progress') || 
          entityId.includes('remaining_time')) {
        if (isDishwasher || isOven) {
          d.attributes.remaining_time = newState.state;
          if (newState.attributes?.unit_of_measurement) {
            d.attributes.remaining_time_unit = newState.attributes.unit_of_measurement;
          }
          isRelated = true;
        }
      }
      if (entityId.includes('completion_time') || entityId.includes('end_time') || entityId.includes('completion')) {
        if (isDishwasher || isOven) {
          d.attributes.completion_time = newState.state;
          isRelated = true;
        }
      }
      if (entityId.includes('child_lock')) {
        if (isOven || isDishwasher) {
          d.attributes.child_lock = (newState.state === 'on' || newState.state === 'true');
          isRelated = true;
        }
      }
      if (entityId.includes('door')) {
        if (isOven || isDishwasher) {
          d.attributes.door_open = (newState.state === 'on' || newState.state === 'open');
          isRelated = true;
        }
      }
      if (entityId.includes('second_cavity_setpoint')) {
        if (isOven) {
          d.attributes.second_cavity_setpoint = parseFloat(newState.state);
          isRelated = true;
        }
      } else if (entityId.includes('setpoint') || entityId.includes('target_temperature')) {
        if (isOven || d.domain === 'climate') {
          d.attributes.setpoint = parseFloat(newState.state);
          if (newState.attributes?.unit_of_measurement) {
            d.attributes.setpoint_unit = newState.attributes.unit_of_measurement;
          }
          isRelated = true;
        }
      }
      if (entityId.includes('operation_state') || entityId.includes('operating_state') || entityId.includes('job_state') || entityId.includes('current_status')) {
        if (isDishwasher || isOven) {
          d.attributes.operating_state = newState.state;
          d.attributes.status = newState.state;
          d.state = newState.state;
          isRelated = true;
        }
      }
      if (entityId.includes('current_cycle') || entityId.includes('cycle') || entityId.includes('program')) {
        if (isDishwasher || isOven) {
          d.attributes.cycle = newState.state;
          d.attributes.current_cycle = newState.state;
          isRelated = true;
        }
      }
      if (entityId.includes('total_time')) {
        if (isDishwasher || isOven) {
          d.attributes.total_time = newState.state;
          if (newState.attributes?.unit_of_measurement) {
            d.attributes.total_time_unit = newState.attributes.unit_of_measurement;
          }
          isRelated = true;
        }
      }
      if (entityId.includes('mode')) {
        if (isOven) {
          d.attributes.mode = newState.state;
          isRelated = true;
        }
      }
      if (entityId.includes('rinse_refill')) {
        if (isDishwasher) {
          d.attributes.rinse_refill_needed = (newState.state === 'on');
          isRelated = true;
        }
      }
      if (entityId.includes('clean_indicator') || entityId.includes('clean_complete')) {
        if (isDishwasher) {
          d.attributes.clean_complete = (newState.state === 'on');
          isRelated = true;
        }
      }

      if (d.related) {
        const item = d.related.find(r => r.entity_id === entityId);
        if (item) {
          item.state = newState.state;
          item.attributes = { ...item.attributes, ...newState.attributes };
        }
      }

      if (isRelated) {
        // Compound appliance always takes precedence as targetDevice over subordinate child entities
        targetDevice = d;
      }
    }

    // 3. Emit notification for spatial cards
    if (this.onEntityStateChanged) {
      this.onEntityStateChanged(entityId, newState, targetDevice);
    }
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
            entity_id: entity.entity_id,
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
