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
    this.wsPendingCalls = new Map();
    this.webrtcSessions = new Map();
    this.webrtcPendingOffers = new Map();
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
      this.fetchLiveStates();
    } else if (msg.type === 'auth_invalid') {
      console.error("[HA WebSocket] Authentication failed:", msg.message);
      this.wsConnected = false;
    } else if (msg.type === 'event' && msg.event?.event_type === 'state_changed') {
      const data = msg.event.data;
      if (!data) return;
      this.processStateChangedEvent(data.entity_id, data.new_state, data.old_state);
    } else if (msg.type === 'event' && msg.id && this.webrtcPendingOffers.has(msg.id)) {
      const session = this.webrtcPendingOffers.get(msg.id);
      const ev = msg.event;
      if (!ev) return;
      if (ev.type === 'session') {
        session.sessionId = ev.session_id;
        console.log(`[HA WebRTC] Established session ID: ${session.sessionId} for ${session.entityId}`);
        if (session.queuedCandidates && session.queuedCandidates.length > 0) {
          for (const cand of session.queuedCandidates) {
            this.sendIceCandidate(session.entityId, session.sessionId, cand);
          }
          session.queuedCandidates = [];
        }
      } else if (ev.type === 'answer' && ev.answer) {
        console.log(`[HA WebRTC] Received remote SDP answer for ${session.entityId}`);
        if (session.pc && session.pc.signalingState !== 'closed') {
          session.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: ev.answer }))
            .catch(err => console.warn(`[HA WebRTC] Failed to set remote description for ${session.entityId}:`, err));
        }
      } else if (ev.type === 'candidate' && ev.candidate) {
        console.log(`[HA WebRTC] Received remote ICE candidate for ${session.entityId}`);
        if (session.pc && session.pc.signalingState !== 'closed') {
          session.pc.addIceCandidate(new RTCIceCandidate(ev.candidate))
            .catch(err => console.warn(`[HA WebRTC] Failed to add remote candidate for ${session.entityId}:`, err));
        }
      } else if (ev.type === 'error') {
        console.error(`[HA WebRTC] Error event for ${session.entityId}:`, ev.message || ev.code);
        if (session.onError) {
          session.onError(new Error(ev.message || ev.code || 'WebRTC session error'));
        }
      }
    } else if (msg.type === 'result' && msg.id && this.webrtcPendingOffers.has(msg.id)) {
      const session = this.webrtcPendingOffers.get(msg.id);
      if (msg.success === false) {
        console.error(`[HA WebRTC] Offer rejected for ${session.entityId}:`, msg.error?.message);
        if (session.onError) {
          session.onError(new Error(msg.error?.message || 'WebRTC offer rejected'));
        }
      }
    } else if (msg.type === 'result' && msg.id && this.wsPendingCalls.has(msg.id)) {
      const { resolve, reject } = this.wsPendingCalls.get(msg.id);
      this.wsPendingCalls.delete(msg.id);
      if (msg.success !== false) {
        resolve(msg.result !== undefined ? msg.result : true);
      } else {
        reject(new Error(msg.error?.message || 'WebSocket command reported unsuccessful'));
      }
    }
  }

  async callServiceWs(domain, service, serviceData = {}, target = {}) {
    if (!this.wsConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[HA-DEBUG:callServiceWs] Cannot call ${domain}.${service} via WebSocket: wsConnected=${this.wsConnected}, readyState=${this.ws?.readyState}`);
      return null;
    }
    return new Promise((resolve, reject) => {
      this.wsMsgId++;
      const id = this.wsMsgId;
      console.log(`[HA-DEBUG:callServiceWs:SEND] id=${id}, ${domain}.${service}`, { serviceData, target });
      const timeout = setTimeout(() => {
        if (this.wsPendingCalls.has(id)) {
          this.wsPendingCalls.delete(id);
          console.error(`[HA-DEBUG:callServiceWs:TIMEOUT] id=${id}, ${domain}.${service}`);
          reject(new Error("WebSocket call_service timed out"));
        }
      }, 10000);

      this.wsPendingCalls.set(id, {
        resolve: (res) => {
          clearTimeout(timeout);
          console.log(`[HA-DEBUG:callServiceWs:RESOLVE] id=${id}, ${domain}.${service}`, res);
          resolve(res);
        },
        reject: (err) => {
          clearTimeout(timeout);
          console.error(`[HA-DEBUG:callServiceWs:REJECT] id=${id}, ${domain}.${service}`, err);
          reject(err);
        }
      });

      const sData = { ...serviceData };
      if (target?.entity_id && !sData.entity_id) {
        sData.entity_id = target.entity_id;
      }

      const payload = {
        id,
        type: 'call_service',
        domain,
        service,
        service_data: sData,
        target
      };
      this.ws.send(JSON.stringify(payload));
    });
  }

  async fetchLiveStates(targetEntityId = null) {
    console.log(`[HA-DEBUG:fetchLiveStates] Initiated. targetEntityId=${targetEntityId}, wsConnected=${this.wsConnected}, readyState=${this.ws?.readyState}`);

    // If a specific targetEntityId is requested (e.g. during pairing), ask HA to poll the real hardware first
    if (targetEntityId && this.wsConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        console.log(`[HA-DEBUG:fetchLiveStates] Requesting hardware entity update for ${targetEntityId}...`);
        await this.callServiceWs('homeassistant', 'update_entity', {}, { entity_id: targetEntityId });
        // Allow a brief moment for integration to complete poll
        await new Promise(res => setTimeout(res, 350));
      } catch (pollErr) {
        console.warn(`[HA-DEBUG:fetchLiveStates] homeassistant.update_entity failed:`, pollErr.message);
      }
    }

    if (this.wsConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        console.log(`[HA-DEBUG:fetchLiveStates] Sending get_states via WebSocket (id: ${this.wsMsgId + 1})`);
        const states = await new Promise((resolve, reject) => {
          this.wsMsgId++;
          const id = this.wsMsgId;
          const timeout = setTimeout(() => {
            if (this.wsPendingCalls.has(id)) {
              this.wsPendingCalls.delete(id);
              reject(new Error("Timeout waiting for get_states response (4s)"));
            }
          }, 4000);
          this.wsPendingCalls.set(id, {
            resolve: (res) => { clearTimeout(timeout); resolve(res); },
            reject: (err) => { clearTimeout(timeout); reject(err); }
          });
          this.ws.send(JSON.stringify({ id, type: 'get_states' }));
        });
        if (Array.isArray(states)) {
          const lockStates = states.filter(s => s.entity_id.startsWith('lock.') || (s.attributes && s.attributes.device_class === 'lock'));
          console.log(`[HA-DEBUG:fetchLiveStates] HA returned ${states.length} states. Lock entities found in HA:`, lockStates.map(l => ({ id: l.entity_id, state: l.state, attr: l.attributes })));

          states.forEach(s => {
            if (this.devices.has(s.entity_id)) {
              const d = this.devices.get(s.entity_id);
              if (d.domain === 'lock' || s.entity_id.startsWith('lock.')) {
                const lState = (s.state || '').toLowerCase();
                console.log(`[HA-DEBUG:fetchLiveStates:LOCK] Updating lock ${s.entity_id}: previous='${d.state}', received='${s.state}' -> parsed='${lState}'`);
                if (['locked', 'unlocked', 'jammed'].includes(lState)) {
                  d.state = lState;
                  d.isOn = (lState === 'locked');
                } else {
                  console.warn(`[HA-DEBUG:fetchLiveStates:LOCK] Ignored non-terminal state '${s.state}' for ${s.entity_id}`);
                }
              } else {
                d.state = s.state;
                d.isOn = ['on', 'cleaning', 'locked', 'running', 'lamp_on'].includes(s.state);
              }
              d.attributes = { ...d.attributes, ...s.attributes };
            }
          });

          // Synchronize compound appliances (appliance.oven, appliance.dishwasher) from raw HA states
          const statesMap = new Map(states.map(s => [s.entity_id, s]));
          for (const d of this.devices.values()) {
            const devId = (d.id || d.entity_id || '');
            const isDishwasher = d.domain === 'dishwasher' || devId.includes('dishwasher');
            const isOven = d.domain === 'oven' || devId.includes('oven');
            const isLitterRobot = d.domain === 'litter_robot' || devId.includes('litter_robot');
            if (!isDishwasher && !isOven && !isLitterRobot) continue;
            if (!d.attributes) d.attributes = {};

            // 1. Sync all matching entities in d.related
            if (Array.isArray(d.related)) {
              d.related.forEach(r => {
                const raw = statesMap.get(r.entity_id);
                if (raw) {
                  r.state = raw.state;
                  r.attributes = { ...r.attributes, ...raw.attributes };
                }
              });
            }

            // 2. Synchronize oven specific state & lamp
            if (isOven) {
              let lampRaw = null;
              if (d.attributes.lamp_entity && statesMap.has(d.attributes.lamp_entity)) {
                lampRaw = statesMap.get(d.attributes.lamp_entity);
              } else {
                // Find matching oven lamp or light in returned states
                lampRaw = states.find(s => {
                  const id = s.entity_id.toLowerCase();
                  return (id.startsWith('light.') || id.startsWith('select.') || id.startsWith('switch.') || id.startsWith('sensor.') || id.startsWith('binary_sensor.')) &&
                         id.includes('oven') && (id.includes('lamp') || id.includes('light'));
                });
                if (lampRaw) {
                  d.attributes.lamp_entity = lampRaw.entity_id;
                  d.attributes.lamp_controllable = !lampRaw.entity_id.startsWith('sensor.') && !lampRaw.entity_id.startsWith('binary_sensor.');
                }
              }

              if (lampRaw) {
                d.attributes.lamp_state = lampRaw.state;
                console.log(`[HA-DEBUG:fetchLiveStates:OVEN] Hydrated lamp_state='${lampRaw.state}' from ${lampRaw.entity_id}`);
              }

              // Operating state & status
              const opState = states.find(s => s.entity_id === 'sensor.oven_operating_state' || (s.entity_id.includes('oven') && s.entity_id.includes('operating_state')));
              if (opState) {
                d.attributes.operating_state = opState.state;
                d.attributes.status = opState.state;
                d.state = opState.state;
              }

              // Setpoint
              const sp = states.find(s => s.entity_id === 'sensor.oven_setpoint' || (s.entity_id.includes('oven') && s.entity_id.includes('setpoint')));
              if (sp && !isNaN(parseFloat(sp.state))) {
                d.attributes.setpoint = parseFloat(sp.state);
              }

              // Door
              const door = states.find(s => (s.entity_id.startsWith('binary_sensor.') && s.entity_id.includes('oven') && s.entity_id.includes('door')));
              if (door) {
                d.attributes.door_open = (door.state === 'on' || door.state === 'open');
              }
            }

            // 3. Synchronize dishwasher specific state
            if (isDishwasher) {
              const opState = states.find(s => s.entity_id.includes('dishwasher') && s.entity_id.includes('operating_state'));
              if (opState) {
                d.attributes.operating_state = opState.state;
                d.attributes.status = opState.state;
                d.state = opState.state;
              }
              const door = states.find(s => s.entity_id.startsWith('binary_sensor.') && s.entity_id.includes('dishwasher') && s.entity_id.includes('door'));
              if (door) {
                d.attributes.door_open = (door.state === 'on' || door.state === 'open');
              }
            }

            // 4. Synchronize Litter-Robot specific state
            if (isLitterRobot) {
              const litterRaw = states.find(s => s.entity_id.startsWith('sensor.') && (s.entity_id.includes('litter_robot') || s.entity_id.includes('litter')) && s.entity_id.includes('litter_level'));
              if (litterRaw && !isNaN(parseFloat(litterRaw.state))) {
                d.attributes.litter_level = Math.round(parseFloat(litterRaw.state));
              }

              const wasteRaw = states.find(s => s.entity_id.startsWith('sensor.') && (s.entity_id.includes('litter_robot') || s.entity_id.includes('waste')) && s.entity_id.includes('waste_drawer'));
              if (wasteRaw && !isNaN(parseFloat(wasteRaw.state))) {
                d.attributes.waste_drawer = Math.round(parseFloat(wasteRaw.state));
              }

              const statusRaw = states.find(s => s.entity_id.startsWith('sensor.') && (s.entity_id.includes('litter_robot') || s.entity_id.includes('litter')) && (s.entity_id.includes('status') || s.entity_id.includes('activity')));
              if (statusRaw) {
                d.attributes.status = statusRaw.state;
                d.state = statusRaw.state;
              }

              const resetBtn = states.find(s => s.entity_id.startsWith('button.') && (s.entity_id.includes('litter_robot') || s.entity_id.includes('litter')) && s.entity_id.includes('reset'));
              if (resetBtn && !d.attributes.reset_button_entity) {
                d.attributes.reset_button_entity = resetBtn.entity_id;
              }
              console.log(`[HA-DEBUG:fetchLiveStates:LITTER_ROBOT] Hydrated litter=${d.attributes.litter_level}%, waste=${d.attributes.waste_drawer}%, status='${d.attributes.status}'`);
            }
          }

          // Hydrate Camera Entities from Home Assistant
          const cameraStates = states.filter(s => s.entity_id.startsWith('camera.'));
          let camerasAdded = 0;
          cameraStates.forEach(cam => {
            if (!this.devices.has(cam.entity_id)) {
              this.devices.set(cam.entity_id, {
                id: cam.entity_id,
                entity_id: cam.entity_id,
                domain: 'camera',
                name: cam.attributes?.friendly_name || cam.entity_id,
                area: cam.attributes?.area || 'Other',
                state: cam.state,
                attributes: cam.attributes || {},
                access_token: cam.attributes?.access_token || null,
                entity_picture: cam.attributes?.entity_picture || null,
                related: []
              });
              camerasAdded++;
            } else {
              const existing = this.devices.get(cam.entity_id);
              if (cam.attributes?.access_token) existing.access_token = cam.attributes.access_token;
              if (cam.attributes?.entity_picture) existing.entity_picture = cam.attributes.entity_picture;
            }
          });
          if (camerasAdded > 0) {
            console.log(`[HA-DEBUG:fetchLiveStates:CAMERA] Added ${camerasAdded} camera entities to device map.`);
            if (this.onDevicesChanged) {
              this.onDevicesChanged(this.devices);
            }
          }
          return true;
        }
      } catch (err) {
        console.warn("[HA-DEBUG:fetchLiveStates] WebSocket get_states failed:", err.message);
      }
    } else {
      console.warn("[HA-DEBUG:fetchLiveStates] WebSocket is NOT connected/open. Falling back to HTTP refreshDevices()...");
    }

    // HTTP Fallback to guarantee live state retrieval
    try {
      console.log("[HA-DEBUG:fetchLiveStates] Executing HTTP refreshDevices() fallback...");
      await this.refreshDevices();
      const lockList = Array.from(this.devices.values()).filter(d => d.domain === 'lock' || d.id.startsWith('lock.'));
      console.log("[HA-DEBUG:fetchLiveStates] HTTP refresh finished. Locks in device map:", lockList.map(l => ({ id: l.id, state: l.state, isOn: l.isOn })));
      return true;
    } catch (httpErr) {
      console.error("[HA-DEBUG:fetchLiveStates] HTTP refresh failed:", httpErr);
      return false;
    }
  }

  processStateChangedEvent(entityId, newState, oldState) {
    if (!newState) return;
    let targetDevice = null;

    // 1. Direct device match
    if (this.devices.has(entityId)) {
      const d = this.devices.get(entityId);
      const isLock = (d.domain === 'lock' || entityId.startsWith('lock.'));
      if (isLock) {
        const lState = (newState.state || '').toLowerCase();
        console.log(`[HA-DEBUG:WS-EVENT:LOCK] Direct match ${entityId}: oldState='${oldState?.state}', receivedState='${newState.state}' -> parsed='${lState}' (current d.state='${d.state}')`);

        // Check if an optimistic command is still within its confirmation grace window (e.g. 5 seconds)
        const isGraceActive = d._pendingAction && (Date.now() < d._pendingAction.expiresAt);
        const isSameStateEcho = oldState && (oldState.state === newState.state);

        if (isGraceActive && lState !== d._pendingAction.state) {
          console.warn(`[HA-DEBUG:WS-EVENT:LOCK] Ignored stale event '${newState.state}' for ${entityId} while waiting for command '${d._pendingAction.state}' (grace expires in ${Math.round((d._pendingAction.expiresAt - Date.now())/1000)}s)`);
        } else if (isSameStateEcho && d.state && d.state !== lState) {
          console.warn(`[HA-DEBUG:WS-EVENT:LOCK] Ignored attribute-only echo event for ${entityId} (old='${oldState?.state}', new='${newState.state}'), preserving active state='${d.state}'`);
        } else if (['locked', 'unlocked', 'jammed'].includes(lState)) {
          d.state = lState;
          d.isOn = (lState === 'locked');
          if (d._pendingAction && lState === d._pendingAction.state) {
            d._pendingAction = null; // Command confirmed by HA
          }
          console.log(`[HA-DEBUG:WS-EVENT:LOCK] Set d.state='${d.state}', d.isOn=${d.isOn}`);
        } else {
          console.warn(`[HA-DEBUG:WS-EVENT:LOCK] Ignored non-terminal state '${newState.state}' for ${entityId}`);
        }
      } else {
        d.state = newState.state;
        d.isOn = ['on', 'cleaning', 'locked', 'running', 'lamp_on'].includes(newState.state) || (d.domain === 'climate' && newState.state !== 'off');
      }
      d.attributes = { ...d.attributes, ...newState.attributes };
      if (d.domain === 'climate' || entityId.startsWith('climate.')) {
        if (newState.attributes?.temperature !== undefined) d.temperature = newState.attributes.temperature;
        if (newState.attributes?.target_temp_low !== undefined) d.target_temp_low = newState.attributes.target_temp_low;
        if (newState.attributes?.target_temp_high !== undefined) d.target_temp_high = newState.attributes.target_temp_high;
        if (newState.attributes?.current_temperature !== undefined) d.current_temperature = newState.attributes.current_temperature;
      }
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

    // 2. Check if this entity is associated with a compound appliance (dishwasher, oven, vacuum station, climate, etc.)
    for (const d of this.devices.values()) {
      let isRelated = false;
      const devId = (d.id || d.entity_id || '');
      const isDishwasher = d.domain === 'dishwasher' || devId.includes('dishwasher');
      const isOven = d.domain === 'oven' || devId.includes('oven');
      const isLitterRobot = d.domain === 'litter_robot' || devId.includes('litter_robot');
      const isClimate = d.domain === 'climate' || devId.startsWith('climate.');

      // Must be a compound appliance or device with related sensors
      if (!isDishwasher && !isOven && !isLitterRobot && !isClimate) continue;

      // Entity MUST strictly belong to this device - NEVER match unrelated locks, doors, lights, etc.!
      const entityBelongsToAppliance = (isOven && (entityId.includes('oven') || d.attributes?.lamp_entity === entityId)) ||
                                       (isDishwasher && entityId.includes('dishwasher')) ||
                                       (isLitterRobot && (entityId.includes('litter') || entityId.includes('whisker'))) ||
                                       (isClimate && (entityId.includes(devId.split('.')[1] || 'thermostat') || entityId.includes('thermostat') || entityId.includes('nest'))) ||
                                       (d.related && d.related.some(r => r.entity_id === entityId));

      if (!entityBelongsToAppliance) continue;

      // Match via related list
      if (d.related && d.related.some(r => r.entity_id === entityId)) {
        isRelated = true;
      }

      // Match via specific attributes
      if (d.attributes?.lamp_entity === entityId || (isOven && (entityId.includes('lamp') || entityId.includes('light')))) {
        d.attributes.lamp_state = newState.state;
        if (!d.attributes.lamp_entity) d.attributes.lamp_entity = entityId;
        isRelated = true;
        console.log(`[HA-DEBUG:WS-EVENT:OVEN-LAMP] ${entityId} -> lamp_state='${newState.state}'`);
      }
      if (d.attributes?.countdown_entity === entityId || 
          entityId.includes('remaining_program_time') || 
          entityId.includes('program_progress') || 
          entityId.includes('remaining_time')) {
        d.attributes.remaining_time = newState.state;
        if (newState.attributes?.unit_of_measurement) {
          d.attributes.remaining_time_unit = newState.attributes.unit_of_measurement;
        }
        isRelated = true;
      }
      if (entityId.includes('completion_time') || entityId.includes('end_time') || entityId.includes('completion')) {
        d.attributes.completion_time = newState.state;
        isRelated = true;
      }
      if (entityId.includes('child_lock')) {
        d.attributes.child_lock = (newState.state === 'on' || newState.state === 'true');
        isRelated = true;
      }
      if (entityId.includes('door')) {
        d.attributes.door_open = (newState.state === 'on' || newState.state === 'open');
        isRelated = true;
      }
      if (entityId.includes('second_cavity_setpoint')) {
        if (isOven) {
          d.attributes.second_cavity_setpoint = parseFloat(newState.state);
          isRelated = true;
        }
      } else if (entityId.includes('setpoint') || entityId.includes('target_temperature')) {
        d.attributes.setpoint = parseFloat(newState.state);
        if (newState.attributes?.unit_of_measurement) {
          d.attributes.setpoint_unit = newState.attributes.unit_of_measurement;
        }
        isRelated = true;
      }
      if (entityId.includes('operation_state') || entityId.includes('operating_state') || entityId.includes('job_state') || entityId.includes('current_status')) {
        d.attributes.operating_state = newState.state;
        d.attributes.status = newState.state;
        d.state = newState.state;
        isRelated = true;
      }
      if (entityId.includes('current_cycle') || entityId.includes('cycle') || entityId.includes('program')) {
        d.attributes.cycle = newState.state;
        d.attributes.current_cycle = newState.state;
        isRelated = true;
      }
      if (entityId.includes('total_time')) {
        d.attributes.total_time = newState.state;
        if (newState.attributes?.unit_of_measurement) {
          d.attributes.total_time_unit = newState.attributes.unit_of_measurement;
        }
        isRelated = true;
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
      if (isLitterRobot) {
        if (entityId.includes('litter_level')) {
          const val = parseFloat(newState.state);
          if (!isNaN(val)) d.attributes.litter_level = Math.round(val);
          isRelated = true;
        }
        if (entityId.includes('waste_drawer')) {
          const val = parseFloat(newState.state);
          if (!isNaN(val)) d.attributes.waste_drawer = Math.round(val);
          isRelated = true;
        }
        if (entityId.includes('status') || entityId.includes('activity')) {
          d.attributes.status = newState.state;
          d.state = newState.state;
          isRelated = true;
        }
      }

      if (isClimate) {
        if (entityId.includes('temperature') || entityId.includes('temp')) {
          const val = parseFloat(newState.state);
          if (!isNaN(val)) {
            d.attributes.current_temperature = val;
            d.current_temperature = val;
          }
          isRelated = true;
        }
        if (entityId.includes('humidity')) {
          const val = parseFloat(newState.state);
          if (!isNaN(val)) {
            d.attributes.current_humidity = val;
          }
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

      if (isRelated && !targetDevice) {
        // Only set targetDevice to compound appliance if no direct primary device matched
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
            isOn: (entity.state === 'on' || entity.state === 'cleaning' || entity.state === 'locked' || entity.state === 'running' || (domain === 'climate' && entity.state !== 'off')),
            brightness: entity.attributes?.brightness ? Math.round((entity.attributes.brightness / 255) * 100) : 100,
            battery: battery,
            fanSpeed: entity.attributes?.fan_speed || null,
            temperature: entity.attributes?.temperature !== undefined ? entity.attributes.temperature : null,
            target_temp_low: entity.attributes?.target_temp_low !== undefined ? entity.attributes.target_temp_low : null,
            target_temp_high: entity.attributes?.target_temp_high !== undefined ? entity.attributes.target_temp_high : null,
            current_temperature: entity.attributes?.current_temperature !== undefined ? entity.attributes.current_temperature : null,
            min_temp: entity.attributes?.min_temp || 7,
            max_temp: entity.attributes?.max_temp || 35,
            target_temp_step: entity.attributes?.target_temp_step || 0.5,
            hvac_modes: entity.attributes?.hvac_modes || ['off', 'heat', 'cool', 'heat_cool'],
            hvac_action: entity.attributes?.hvac_action || entity.state,
            access_token: entity.attributes?.access_token || null,
            entity_picture: entity.attributes?.entity_picture || null,
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
    const d = this.devices.get(deviceId);
    const targetLamp = lampEntity || d?.attributes?.lamp_entity;
    console.log(`[HA-DEBUG:toggleOvenLamp] deviceId=${deviceId}, option=${option}, targetLamp=${targetLamp}, wsConnected=${this.wsConnected}`);

    if (this.wsConnected && targetLamp) {
      try {
        const lDomain = targetLamp.split('.')[0];
        console.log(`[HA-DEBUG:toggleOvenLamp:WS] Direct WebSocket dispatch on ${targetLamp}, option=${option}`);
        let wsRes = null;
        if (lDomain === 'light') {
          const lService = (option === 'on') ? 'turn_on' : (option === 'off' ? 'turn_off' : 'toggle');
          wsRes = await this.callServiceWs('light', lService, {}, { entity_id: targetLamp });
        } else if (lDomain === 'select') {
          wsRes = await this.callServiceWs('select', 'select_option', { option }, { entity_id: targetLamp });
        } else if (lDomain === 'switch') {
          const sService = (option === 'on') ? 'turn_on' : 'turn_off';
          wsRes = await this.callServiceWs('switch', sService, {}, { entity_id: targetLamp });
        }
        if (wsRes !== null) {
          if (d && d.attributes) d.attributes.lamp_state = option;
          if (this.onEntityStateChanged) {
            this.onEntityStateChanged(targetLamp, { state: option }, d);
          }
          return true;
        }
      } catch (wsErr) {
        console.warn("[HA-DEBUG:toggleOvenLamp:WS-FAIL] Falling back to HTTP:", wsErr);
      }
    }
    const httpRes = await this.controlDevice(deviceId, 'toggle_lamp', { option, lamp_entity: targetLamp });
    if (httpRes) {
      if (d && d.attributes) d.attributes.lamp_state = option;
      if (this.onEntityStateChanged) {
        this.onEntityStateChanged(targetLamp, { state: option }, d);
      }
    }
    return httpRes;
  }

  async resetLitterRobot(deviceId, buttonEntity = null) {
    const d = this.devices.get(deviceId);
    const targetBtn = buttonEntity || d?.attributes?.reset_button_entity;
    console.log(`[HA-DEBUG:resetLitterRobot] deviceId=${deviceId}, targetBtn=${targetBtn}, wsConnected=${this.wsConnected}`);

    if (this.wsConnected && targetBtn) {
      try {
        const bDomain = targetBtn.split('.')[0] || 'button';
        const bService = bDomain === 'button' ? 'press' : 'turn_on';
        console.log(`[HA-DEBUG:resetLitterRobot:WS] Calling ${bDomain}.${bService} on ${targetBtn}`);
        const wsRes = await this.callServiceWs(bDomain, bService, {}, { entity_id: targetBtn });
        if (wsRes !== null) {
          return true;
        }
      } catch (wsErr) {
        console.warn("[HA-DEBUG:resetLitterRobot:WS-FAIL] Falling back to HTTP:", wsErr);
      }
    }
    return await this.controlDevice(deviceId, 'reset', { reset_button_entity: targetBtn });
  }

  // --- Thermostat / Climate Controls ---
  async setThermostatTemperature(deviceId, options) {
    let serviceData = {};
    if (typeof options === 'object' && options !== null) {
      if (options.temperature !== undefined) serviceData.temperature = parseFloat(options.temperature);
      if (options.target_temp_low !== undefined) serviceData.target_temp_low = parseFloat(options.target_temp_low);
      if (options.target_temp_high !== undefined) serviceData.target_temp_high = parseFloat(options.target_temp_high);
    } else {
      serviceData.temperature = parseFloat(options);
    }
    console.log(`[HA-DEBUG:setThermostatTemperature] deviceId=${deviceId}, serviceData=`, serviceData);
    return await this.controlDevice(deviceId, 'set_temperature', serviceData, 'climate');
  }

  async setThermostatMode(deviceId, hvacMode) {
    console.log(`[HA-DEBUG:setThermostatMode] deviceId=${deviceId}, hvacMode=${hvacMode}`);
    return await this.controlDevice(deviceId, 'set_hvac_mode', { hvac_mode: hvacMode }, 'climate');
  }

  // --- Camera Controls & WebRTC Stream Resolution ---
  sendIceCandidate(entityId, sessionId, candidateStr) {
    if (!this.wsConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.wsMsgId++;
    this.ws.send(JSON.stringify({
      id: this.wsMsgId,
      type: 'camera/webrtc/candidate',
      entity_id: entityId,
      session_id: sessionId,
      candidate: candidateStr
    }));
  }

  async startCameraWebRtc(entityId, onStream, onError) {
    if (!this.wsConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      const err = new Error("WebSocket not connected to Home Assistant");
      if (onError) onError(err);
      throw err;
    }

    // Clean up existing session for this entity if any
    this.stopCameraWebRtc(entityId);

    console.log(`[HA WebRTC] Initiating WebRTC peer connection for ${entityId}...`);
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    });

    const session = {
      entityId,
      pc,
      sessionId: null,
      offerId: null,
      queuedCandidates: [],
      onStream,
      onError
    };

    // Google Nest SDM API requires m-lines in exact order: audio, video, application
    pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.createDataChannel('dataSendChannel');

    pc.onicecandidate = (event) => {
      if (event.candidate && event.candidate.candidate) {
        if (session.sessionId) {
          this.sendIceCandidate(entityId, session.sessionId, event.candidate.candidate);
        } else {
          session.queuedCandidates.push(event.candidate.candidate);
        }
      }
    };

    let streamDelivered = false;
    let fallbackTimer = null;

    pc.ontrack = (event) => {
      console.log(`[HA WebRTC] Media track received for ${entityId}: kind=${event.track.kind}`);
      if (event.streams && event.streams[0]) {
        const stream = event.streams[0];
        if (!streamDelivered) {
          // Prefer delivering once the video track has arrived
          if (event.track.kind === 'video' || stream.getVideoTracks().length > 0) {
            streamDelivered = true;
            if (fallbackTimer) clearTimeout(fallbackTimer);
            if (onStream) onStream(stream);
          } else if (!fallbackTimer) {
            // If only audio arrives first, give a short grace period for video before fallback
            fallbackTimer = setTimeout(() => {
              if (!streamDelivered) {
                streamDelivered = true;
                if (onStream) onStream(stream);
              }
            }, 800);
            session.fallbackTimer = fallbackTimer;
          }
        }
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[HA WebRTC] Connection state for ${entityId}: ${pc.connectionState}`);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        if (onError) onError(new Error(`WebRTC connection ${pc.connectionState}`));
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.wsMsgId++;
      const offerId = this.wsMsgId;
      session.offerId = offerId;

      this.webrtcPendingOffers.set(offerId, session);
      this.webrtcSessions.set(entityId, session);

      console.log(`[HA WebRTC] Sending camera/webrtc/offer (id: ${offerId}) for ${entityId}`);
      this.ws.send(JSON.stringify({
        id: offerId,
        type: 'camera/webrtc/offer',
        entity_id: entityId,
        offer: pc.localDescription.sdp
      }));

      return session;
    } catch (err) {
      console.error(`[HA WebRTC] Failed to create or send offer for ${entityId}:`, err);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      pc.close();
      if (onError) onError(err);
      throw err;
    }
  }

  stopCameraWebRtc(entityId) {
    const session = this.webrtcSessions.get(entityId);
    if (session) {
      console.log(`[HA WebRTC] Stopping WebRTC session for ${entityId}`);
      if (session.fallbackTimer) {
        clearTimeout(session.fallbackTimer);
        session.fallbackTimer = null;
      }
      try {
        if (session.pc) {
          session.pc.ontrack = null;
          session.pc.onicecandidate = null;
          session.pc.onconnectionstatechange = null;
          session.pc.close();
        }
      } catch (e) {
        console.warn(`[HA WebRTC] Error closing peer connection for ${entityId}:`, e);
      }
      if (session.offerId) {
        this.webrtcPendingOffers.delete(session.offerId);
      }
      this.webrtcSessions.delete(entityId);
    }
  }

  // --- Switch / Generic Appliance Controls ---
  async toggleSwitch(deviceId, isOn) {
    return await this.controlDevice(deviceId, isOn ? 'turn_on' : 'turn_off');
  }
  
  _applyLocalState(entity_id, service, service_data) {
      const d = this.devices.get(entity_id);
      if (d) {
          const prevState = d.state;
          const prevIsOn = d.isOn;
          if (service === 'turn_on') { d.isOn = true; d.state = 'on'; }
          if (service === 'turn_off') { d.isOn = false; d.state = 'off'; }
          if (service === 'lock') {
              d.state = 'locked';
              d.isOn = true;
              d._pendingAction = { state: 'locked', expiresAt: Date.now() + 5000 };
          }
          if (service === 'unlock') {
              d.state = 'unlocked';
              d.isOn = false;
              d._pendingAction = { state: 'unlocked', expiresAt: Date.now() + 5000 };
          }
          if (service === 'start' || service === 'start_pause') { d.state = 'cleaning'; d.isOn = true; }
          if (service === 'pause') { d.state = 'paused'; }
          if (service === 'stop' || service === 'return_to_base') { d.state = 'returning'; }
          if (service === 'set_fan_speed' && service_data?.fan_speed) { d.fanSpeed = service_data.fan_speed; }
          if (service === 'set_temperature') {
              if (!d.attributes) d.attributes = {};
              if (service_data?.temperature !== undefined) {
                  const tVal = parseFloat(service_data.temperature);
                  d.attributes.temperature = tVal;
                  d.temperature = tVal;
              }
              if (service_data?.target_temp_low !== undefined) {
                  const lowVal = parseFloat(service_data.target_temp_low);
                  d.attributes.target_temp_low = lowVal;
                  d.target_temp_low = lowVal;
              }
              if (service_data?.target_temp_high !== undefined) {
                  const highVal = parseFloat(service_data.target_temp_high);
                  d.attributes.target_temp_high = highVal;
                  d.target_temp_high = highVal;
              }
          }
          if (service === 'set_hvac_mode' && service_data?.hvac_mode) {
              d.state = service_data.hvac_mode;
              if (!d.attributes) d.attributes = {};
              d.attributes.hvac_mode = service_data.hvac_mode;
              d.isOn = (d.state !== 'off');
          }
          if (service_data?.brightness !== undefined) {
              d.brightness = Math.round((service_data.brightness / 255) * 100);
          }
          console.log(`[HA-DEBUG:_applyLocalState] ${entity_id} service='${service}': state '${prevState}' -> '${d.state}', isOn ${prevIsOn} -> ${d.isOn}`);
      } else {
          console.warn(`[HA-DEBUG:_applyLocalState] Device not found in map: ${entity_id}`);
      }
  }

  async controlDevice(entity_id, service, service_data = {}, domain = null) {
      const targetDomain = domain || entity_id.split('.')[0];
      console.log(`[HA-DEBUG:controlDevice] Invoked: ${targetDomain}.${service} on ${entity_id}, wsConnected=${this.wsConnected}`);

      // Fast direct WebSocket execution when available (for non-virtual devices)
      if (this.wsConnected && !entity_id.startsWith('appliance.')) {
          try {
              console.log(`[HA-DEBUG:controlDevice:WS] Dispatching ${targetDomain}.${service} on ${entity_id}`);
              const wsRes = await this.callServiceWs(targetDomain, service, service_data, { entity_id });
              if (wsRes !== null) {
                  this._applyLocalState(entity_id, service, service_data);
                  return true;
              }
          } catch (wsErr) {
              console.warn("[HA-DEBUG:controlDevice:WS-FAIL] WebSocket dispatch failed, falling back to HTTP:", wsErr);
          }
      }

      // HTTP Cloud Function fallback
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
          this._applyLocalState(entity_id, service, service_data);
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
