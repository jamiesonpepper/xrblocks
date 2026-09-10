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
    firebaseApiKey: process.env.WEB_API_KEY || ""
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
      {% for s in states if s.domain in ['light', 'switch', 'media_player'] %}
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

    // Filter to relevant domains (light, switch, media_player) and attach area
    const allowedDomains = ['light', 'switch', 'media_player'];
    const devices = states
      .filter(entity => {
        const domain = entity.entity_id.split('.')[0];
        return allowedDomains.includes(domain);
      })
      .map(entity => ({
        ...entity,
        area: areaMap[entity.entity_id] || entity.attributes?.area || 'Other'
      }));

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

  // Fallback domain if not explicitly provided
  const targetDomain = domain || entity_id.split('.')[0];

  try {
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
