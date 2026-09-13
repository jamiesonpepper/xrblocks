const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}
const { getFirestore } = require("firebase-admin/firestore");
// Target the Native Firestore database for XRHome
const db = getFirestore("ai-studio-8ca7d151-310e-4e21-b325-b8b7ea3b1886");

exports.getConfig = functions.https.onRequest((req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.json({
    geminiKey: process.env.GEMINI_API_KEY || "",
    firebaseApiKey: process.env.WEB_API_KEY || "",
    haUrl: process.env.HA_URL || "",
    haToken: process.env.HA_TOKEN || ""
  });
});

// Helper to make Home Assistant REST API calls with retries on transient connection drops
async function callHaApi(endpoint, method = 'GET', body = null) {
  const haUrl = process.env.HA_URL;
  const haToken = process.env.HA_TOKEN;

  if (!haUrl || !haToken) {
    throw new Error("Missing HA_URL or HA_TOKEN in environment variables.");
  }

  const url = `${haUrl.replace(/\/$/, '')}${endpoint}`;
  
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const options = {
        method,
        headers: {
          'Authorization': `Bearer ${haToken}`,
          'Content-Type': 'application/json',
          'Connection': 'close',
        }
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`HA API Error: ${response.status} ${response.statusText} ${errorText}`);
      }

      return await response.json();
    } catch (err) {
      lastError = err;
      console.warn(`callHaApi attempt ${attempt} failed:`, err.message || err);
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 200 * attempt));
      }
    }
  }
  throw lastError;
}

// 1. Fetch devices from Home Assistant
exports.getHaDevices = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  try {
    const states = await callHaApi('/api/states');

    // Query entity area assignments from Home Assistant template API
    let areaMap = {};
    try {
      const templateQuery = `
      {% set ns = namespace(items=[]) %}
      {% for s in states if s.domain in ['light', 'switch', 'lock', 'vacuum', 'climate', 'button', 'select', 'sensor', 'binary_sensor', 'media_player', 'fan', 'cover'] %}
        {% set a = area_name(s.entity_id) %}
        {% set ns.items = ns.items + [{'entity_id': s.entity_id, 'area': a if a else 'Other'}] %}
      {% endfor %}
      {{ ns.items | to_json }}
      `;
      const haUrl = process.env.HA_URL.replace(/\/$/, '');
      const templateResponse = await fetch(`${haUrl}/api/template`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.HA_TOKEN}`,
          'Content-Type': 'application/json',
          'Connection': 'close'
        },
        body: JSON.stringify({ template: templateQuery })
      });
      if (templateResponse.ok) {
        const text = await templateResponse.text();
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          parsed.forEach(item => {
            if (item.entity_id) areaMap[item.entity_id] = item.area || 'Other';
          });
        }
      }
    } catch (areaErr) {
      console.warn("Could not fetch HA areas via template:", areaErr);
    }

    // Filter to relevant domains (lights, switches, locks, vacuums, appliances, sensors)
    const allowedDomains = [
      'light', 'switch', 'lock', 'vacuum', 'climate',
      'button', 'select', 'sensor', 'binary_sensor', 'media_player', 'fan', 'cover'
    ];

    const allFiltered = states
      .filter(entity => {
        const domain = entity.entity_id.split('.')[0];
        return allowedDomains.includes(domain);
      })
      .map(entity => ({
        ...entity,
        area: areaMap[entity.entity_id] || entity.attributes?.area || 'Other'
      }));

    const swallowedEntityIds = new Set();
    const unifiedAppliances = [];

    // --- 1. DISHWASHER UNIFICATION ---
    const dishwasherEntities = allFiltered.filter(e => {
      const id = e.entity_id.toLowerCase();
      const fn = (e.attributes?.friendly_name || '').toLowerCase();
      return id.includes('dishwasher') || fn.includes('dishwasher');
    });

    if (dishwasherEntities.length > 0) {
      dishwasherEntities.forEach(e => {
        if (!e.entity_id.startsWith('sensor.')) {
          swallowedEntityIds.add(e.entity_id);
        }
      });
      const statusSensor = dishwasherEntities.find(e => e.entity_id.includes('current_status') || e.entity_id.includes('status'));
      const cycleSensor = dishwasherEntities.find(e => e.entity_id.includes('current_cycle') || e.entity_id.includes('cycle'));
      const remainingSensor = dishwasherEntities.find(e => e.entity_id.includes('remaining_time') || e.entity_id.includes('remaining'));
      const totalTimeSensor = dishwasherEntities.find(e => e.entity_id.includes('total_time'));
      const delayedStartSensor = dishwasherEntities.find(e => e.entity_id.includes('delayed_start'));
      const doorSensor = dishwasherEntities.find(e => e.entity_id.includes('door'));
      const rinseRefillSensor = dishwasherEntities.find(e => e.entity_id.includes('rinse_refill'));
      const rinseLevelSensor = dishwasherEntities.find(e => e.entity_id.includes('rinse_aid'));
      const cleanLightSensor = dishwasherEntities.find(e => e.entity_id.includes('clean_indicator'));

      const area = dishwasherEntities.find(e => e.area && e.area !== 'Other')?.area || 'Kitchen';
      const rawState = statusSensor?.state || 'ready';

      unifiedAppliances.push({
        entity_id: 'appliance.dishwasher',
        domain: 'dishwasher',
        area,
        state: rawState,
        attributes: {
          friendly_name: 'Dishwasher',
          status: rawState,
          cycle: (cycleSensor && cycleSensor.state !== 'unknown') ? cycleSensor.state : undefined,
          remaining_time: (remainingSensor && remainingSensor.state !== 'unknown') ? remainingSensor.state : undefined,
          total_time: (totalTimeSensor && totalTimeSensor.state !== 'unknown') ? totalTimeSensor.state : undefined,
          delayed_start: (delayedStartSensor && delayedStartSensor.state !== 'unknown') ? delayedStartSensor.state : undefined,
          door_open: doorSensor ? (doorSensor.state === 'on') : undefined,
          rinse_refill_needed: rinseRefillSensor ? (rinseRefillSensor.state === 'on') : undefined,
          rinse_aid_level: (rinseLevelSensor && rinseLevelSensor.state !== 'unknown') ? rinseLevelSensor.state : undefined,
          clean_complete: cleanLightSensor ? (cleanLightSensor.state === 'on') : undefined,
        },
        related: dishwasherEntities.map(e => ({
          entity_id: e.entity_id,
          domain: e.entity_id.split('.')[0],
          name: e.attributes?.friendly_name || e.entity_id,
          state: e.state,
          attributes: e.attributes
        }))
      });
    }

    // --- 2. OVEN UNIFICATION ---
    const ovenEntities = allFiltered.filter(e => {
      const id = e.entity_id.toLowerCase();
      const fn = (e.attributes?.friendly_name || '').toLowerCase();
      return id.includes('oven') || fn.includes('oven');
    });

    if (ovenEntities.length > 0) {
      ovenEntities.forEach(e => {
        if (!e.entity_id.startsWith('sensor.')) {
          swallowedEntityIds.add(e.entity_id);
        }
      });
      const opStateSensor = ovenEntities.find(e => e.entity_id === 'sensor.oven_operating_state' || e.entity_id.includes('operating_state'));
      const jobStateSensor = ovenEntities.find(e => e.entity_id === 'sensor.oven_job_state' || e.entity_id.includes('job_state'));
      const tempSensor = ovenEntities.find(e => e.entity_id === 'sensor.oven_temperature');
      const setpointSensor = ovenEntities.find(e => e.entity_id === 'sensor.oven_setpoint');
      const completionTimeSensor = ovenEntities.find(e => e.entity_id === 'sensor.oven_completion_time');
      const doorSensor = ovenEntities.find(e => e.entity_id === 'binary_sensor.oven_door');
      const childLockSensor = ovenEntities.find(e => e.entity_id === 'binary_sensor.oven_child_lock');
      const modeSensor = ovenEntities.find(e => e.entity_id === 'sensor.oven_oven_mode');
      const stopButton = ovenEntities.find(e => e.entity_id === 'button.oven_stop');
      const lampSelect = ovenEntities.find(e => e.entity_id === 'select.oven_lamp' || (e.entity_id.startsWith('select.') && e.entity_id.includes('lamp')));
      const ovenLight = ovenEntities.find(e => e.entity_id === 'light.oven_light' || (e.entity_id.startsWith('light.') && e.entity_id.includes('oven')));
      const lampSensor = ovenEntities.find(e => 
        (e.entity_id.startsWith('sensor.') || e.entity_id.startsWith('binary_sensor.')) &&
        (e.entity_id.includes('lamp') || e.entity_id.includes('light'))
      );

      let lampEntity = undefined;
      let lampState = undefined;
      let lampControllable = false;

      if (ovenLight) {
        lampEntity = ovenLight.entity_id;
        lampState = ovenLight.state;
        lampControllable = true;
      } else if (lampSelect) {
        lampEntity = lampSelect.entity_id;
        lampState = lampSelect.state;
        lampControllable = true;
      } else if (lampSensor) {
        lampEntity = lampSensor.entity_id;
        lampState = lampSensor.state;
        lampControllable = false;
      }
      
      const secTempSensor = ovenEntities.find(e => e.entity_id === 'sensor.oven_second_cavity_temperature');
      const secSetpointSensor = ovenEntities.find(e => e.entity_id === 'sensor.oven_second_cavity_setpoint');
      const secJobSensor = ovenEntities.find(e => e.entity_id === 'sensor.oven_second_cavity_job_state');

      const area = ovenEntities.find(e => e.area && e.area !== 'Other')?.area || 'Kitchen';
      const rawState = opStateSensor?.state || jobStateSensor?.state || 'ready';

      const tempVal = (tempSensor && tempSensor.state !== 'unavailable' && tempSensor.state !== 'unknown') ? parseFloat(tempSensor.state) : undefined;
      const setVal = (setpointSensor && setpointSensor.state !== 'unavailable' && setpointSensor.state !== 'unknown') ? parseFloat(setpointSensor.state) : undefined;

      unifiedAppliances.push({
        entity_id: 'appliance.oven',
        domain: 'oven',
        area,
        state: rawState,
        attributes: {
          friendly_name: 'Oven',
          status: rawState,
          operating_state: opStateSensor?.state || 'ready',
          job_state: jobStateSensor?.state,
          temperature: tempVal,
          setpoint: setVal,
          completion_time: (completionTimeSensor && completionTimeSensor.state !== 'unknown' && completionTimeSensor.state !== 'unavailable') ? completionTimeSensor.state : undefined,
          door_open: doorSensor ? (doorSensor.state === 'on') : undefined,
          child_lock: childLockSensor ? (childLockSensor.state === 'on') : undefined,
          mode: (modeSensor && modeSensor.state !== 'unknown') ? modeSensor.state : undefined,
          lamp_entity: lampEntity,
          lamp_state: lampState,
          lamp_controllable: lampControllable,
          stop_entity: stopButton ? stopButton.entity_id : undefined,
          second_cavity_temperature: (secTempSensor && secTempSensor.state !== 'unavailable') ? parseFloat(secTempSensor.state) : undefined,
          second_cavity_setpoint: (secSetpointSensor && secSetpointSensor.state !== 'unavailable') ? parseFloat(secSetpointSensor.state) : undefined,
          second_cavity_job_state: (secJobSensor && secJobSensor.state !== 'unknown') ? secJobSensor.state : undefined
        },
        related: ovenEntities.map(e => ({
          entity_id: e.entity_id,
          domain: e.entity_id.split('.')[0],
          name: e.attributes?.friendly_name || e.entity_id,
          state: e.state,
          attributes: e.attributes
        }))
      });
    }

    // --- 3. VACUUM + DOCK UNIFICATION ---
    // Primary controllable device domains + readable sensors
    const primaryDomains = ['light', 'switch', 'lock', 'vacuum', 'climate', 'sensor', 'media_player', 'fan', 'cover'];
    const primaryDevices = [];
    const secondaryEntities = [];

    for (const ent of allFiltered) {
      if (swallowedEntityIds.has(ent.entity_id)) continue;
      const domain = ent.entity_id.split('.')[0];
      if (primaryDomains.includes(domain)) {
        primaryDevices.push({ ...ent, related: [] });
      } else {
        secondaryEntities.push(ent);
      }
    }

    // Unify Vacuum with its dock switches, buttons, and sensors
    for (const p of primaryDevices) {
      const pDomain = p.entity_id.split('.')[0];
      if (pDomain === 'vacuum') {
        const pName = p.entity_id.split('.')[1] || '';
        // Find matching dock switches, sensors, buttons
        const dockAndVacEntities = allFiltered.filter(e => {
          if (e.entity_id === p.entity_id) return false;
          const eId = e.entity_id.toLowerCase();
          const fn = (e.attributes?.friendly_name || '').toLowerCase();
          return (pName && (eId.includes(pName) || fn.includes(pName))) ||
                 eId.includes('dock') || fn.includes('dock');
        });

        // Swallow dock entities so they are not separate standalone switches
        dockAndVacEntities.forEach(e => {
          swallowedEntityIds.add(e.entity_id);
          p.related.push({
            entity_id: e.entity_id,
            domain: e.entity_id.split('.')[0],
            name: e.attributes?.friendly_name || e.entity_id,
            state: e.state,
            attributes: e.attributes
          });
        });

        // Find dock empty switch or button (prioritize actionable switch/button over config select)
        const dockEmptySwitch = dockAndVacEntities.find(e => 
          (e.entity_id.startsWith('button.') || e.entity_id.startsWith('switch.')) &&
          (e.entity_id.includes('empty') || e.entity_id.includes('dust') || (e.attributes?.friendly_name || '').toLowerCase().includes('empty'))
        ) || dockAndVacEntities.find(e => 
          (e.entity_id.includes('empty') || (e.attributes?.friendly_name || '').toLowerCase().includes('empty'))
        );
        if (dockEmptySwitch) {
          p.attributes.dock_empty_entity = dockEmptySwitch.entity_id;
        }

        // Find battery sensor if not already on attributes
        if (p.attributes.battery_level === undefined && p.attributes.battery === undefined) {
          const batt = dockAndVacEntities.find(e => e.entity_id.includes('battery'));
          if (batt && batt.state && !isNaN(batt.state)) {
            p.attributes.battery = parseInt(batt.state, 10);
          }
        }

        // Find dock status / error
        const dockStatus = dockAndVacEntities.find(e => e.entity_id.includes('dock_error') || e.entity_id.includes('dock_status'));
        if (dockStatus) {
          p.attributes.dock_status = dockStatus.state;
        }

        // Find mop and water sensors
        const mopSensor = dockAndVacEntities.find(e => e.entity_id.includes('mop_attached'));
        if (mopSensor) p.attributes.mop_attached = (mopSensor.state === 'on');

        const waterSensor = dockAndVacEntities.find(e => e.entity_id.includes('water_shortage'));
        if (waterSensor) p.attributes.water_shortage = (waterSensor.state === 'on');
      } else {
        // Associate related entities for other primary devices
        const pName = p.entity_id.split('.')[1] || '';
        for (const s of secondaryEntities) {
          const sName = s.entity_id.split('.')[1] || '';
          if (pName && (sName.startsWith(pName) || sName.includes(pName))) {
            p.related.push({
              entity_id: s.entity_id,
              domain: s.entity_id.split('.')[0],
              name: s.attributes?.friendly_name || s.entity_id,
              state: s.state,
              attributes: s.attributes
            });
          }
        }
      }
    }

    // Filter out any primary devices that got swallowed by vacuum dock or appliances
    const filteredPrimary = primaryDevices.filter(p => !swallowedEntityIds.has(p.entity_id));

    // Resulting devices: unified appliances + clean filtered primary devices
    const devices = [...unifiedAppliances, ...filteredPrimary];

    return res.status(200).json({ devices });
  } catch (error) {
    console.error("getHaDevices Error:", error);
    return res.status(500).json({ error: error.message || error });
  }
});

// 2. Control a Home Assistant device
exports.controlHaDevice = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  const { entity_id, service, domain, service_data } = req.body || {};

  if (!entity_id || !service) {
    return res.status(400).json({ error: "Missing entity_id or service in payload." });
  }

  try {
    // Check if targeting a unified appliance
    if (entity_id.startsWith('appliance.')) {
      const applianceType = entity_id.split('.')[1];
      
      if (applianceType === 'oven') {
        if (service === 'stop') {
          // Trigger button.oven_stop
          const result = await callHaApi('/api/services/button/press', 'POST', { entity_id: 'button.oven_stop' });
          return res.status(200).json({ success: true, result });
        }
        if (service === 'toggle_lamp' || service === 'lamp') {
          // Toggle oven lamp select or light
          const option = service_data?.option || 'on';
          const lampEntity = service_data?.lamp_entity || 'select.oven_lamp';
          const lDomain = lampEntity.split('.')[0];
          if (lDomain === 'sensor' || lDomain === 'binary_sensor') {
            return res.status(200).json({ success: false, controllable: false, error: "Oven light is a read-only indicator" });
          }
          try {
            let result;
            if (lDomain === 'light') {
              const lService = (option === 'on') ? 'turn_on' : (option === 'off' ? 'turn_off' : 'toggle');
              result = await callHaApi(`/api/services/light/${lService}`, 'POST', { entity_id: lampEntity });
            } else {
              result = await callHaApi('/api/services/select/select_option', 'POST', { entity_id: lampEntity, option });
            }
            return res.status(200).json({ success: true, controllable: true, result });
          } catch (lampErr) {
            console.warn("Could not toggle oven lamp:", lampErr);
            return res.status(200).json({ success: false, controllable: false, error: lampErr.message });
          }
        }
      }

      if (applianceType === 'dishwasher') {
        if (service === 'start' || service === 'stop') {
          // Call button/switch if supported
          return res.status(200).json({ success: true, note: "Appliance command received" });
        }
      }
    }

    // Vacuum dock empty routing
    if (domain === 'vacuum' && service === 'empty_dock') {
      const dockEntity = service_data?.dock_empty_entity;
      if (dockEntity) {
        const dDomain = dockEntity.split('.')[0];
        const dService = dDomain === 'switch' ? 'turn_on' : 'press';
        const result = await callHaApi(`/api/services/${dDomain}/${dService}`, 'POST', { entity_id: dockEntity });
        return res.status(200).json({ success: true, result });
      } else {
        // Fallback to vacuum.send_command
        const result = await callHaApi('/api/services/vacuum/send_command', 'POST', {
          entity_id,
          command: 'app_start_empty'
        });
        return res.status(200).json({ success: true, result });
      }
    }

    // Fallback domain if not explicitly provided
    const targetDomain = domain || entity_id.split('.')[0];

    const payload = {
      entity_id,
      ...service_data
    };
    
    const result = await callHaApi(`/api/services/${targetDomain}/${service}`, 'POST', payload);
    
    return res.status(200).json({ success: true, result });
  } catch (error) {
    console.error("controlHaDevice Error:", error);
    return res.status(500).json({ error: error.message || error });
  }
});

// 3. Firestore Anchor Persistence Endpoints

// Get all saved anchors
exports.getAnchors = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  try {
    const snapshot = await db.collection("anchors").get();
    const anchors = [];
    snapshot.forEach(doc => {
      anchors.push({ id: doc.id, ...doc.data() });
    });
    return res.status(200).json({ anchors });
  } catch (error) {
    console.error("getAnchors Error:", error);
    return res.status(500).json({ error: error.message || error });
  }
});

// Save or update an anchor
exports.saveAnchor = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  const anchorData = req.body || {};
  const docId = anchorData.id || anchorData.entity_id;

  if (!docId) {
    return res.status(400).json({ error: "Missing anchor id or entity_id." });
  }

  try {
    await db.collection("anchors").doc(docId).set({
      ...anchorData,
      id: docId,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    return res.status(200).json({ success: true, id: docId });
  } catch (error) {
    console.error("saveAnchor Error:", error);
    return res.status(500).json({ error: error.message || error });
  }
});

// Delete a specific anchor
exports.deleteAnchor = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, DELETE, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  const { id, entity_id } = req.body || {};
  const docId = id || entity_id;

  if (!docId) {
    return res.status(400).json({ error: "Missing anchor id or entity_id." });
  }

  try {
    await db.collection("anchors").doc(docId).delete();
    return res.status(200).json({ success: true, deleted: docId });
  } catch (error) {
    console.error("deleteAnchor Error:", error);
    return res.status(500).json({ error: error.message || error });
  }
});

// Reset / wipe all saved anchors
exports.resetAnchors = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  try {
    const snapshot = await db.collection("anchors").get();
    if (snapshot.empty) {
      return res.status(200).json({ success: true, count: 0 });
    }

    const batch = db.batch();
    snapshot.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    return res.status(200).json({ success: true, count: snapshot.size });
  } catch (error) {
    console.error("resetAnchors Error:", error);
    return res.status(500).json({ error: error.message || error });
  }
});
