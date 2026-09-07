const functions = require("firebase-functions/v1");

exports.getConfig = functions.https.onRequest((req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.json({
    geminiKey: process.env.GEMINI_API_KEY || "",
    firebaseApiKey: process.env.WEB_API_KEY || ""
  });
});

// Helper to make Home Assistant REST API calls
async function callHaApi(endpoint, method = 'GET', body = null) {
  const haUrl = process.env.HA_URL;
  const haToken = process.env.HA_TOKEN;

  if (!haUrl || !haToken) {
    throw new Error("Missing HA_URL or HA_TOKEN in environment variables.");
  }

  const url = `${haUrl.replace(/\/$/, '')}${endpoint}`;
  
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${haToken}`,
      'Content-Type': 'application/json',
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  
  if (!response.ok) {
    throw new Error(`HA API Error: ${response.status} ${response.statusText}`);
  }

  return response.json();
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
    
    // Filter to relevant domains (light, switch, media_player)
    const allowedDomains = ['light', 'switch', 'media_player'];
    const devices = states.filter(entity => {
      const domain = entity.entity_id.split('.')[0];
      return allowedDomains.includes(domain);
    });

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
