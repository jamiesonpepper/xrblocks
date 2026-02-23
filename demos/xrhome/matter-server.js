// Force IPv4 to avoid Docker IPv6 issues (ENETUNREACH)
const { Environment } = require('@project-chip/matter.js/environment');
Environment.default.vars.set('network.ipv6', false);
Environment.default.vars.set('mdns.ipv6', false); // Ensure MDNS also ignores IPv6

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { CommissioningController, MatterServer } = require('@project-chip/matter-node.js');

const { StorageBackendDisk, StorageManager } = require('@project-chip/matter-node.js/storage');
const { OnOff, LevelControl, ColorControl } = require('@project-chip/matter.js/cluster');
const { Logger } = require('@project-chip/matter-node.js/log');
Logger.defaultLogLevel = 'debug';

const { ManualPairingCodeCodec } = require('@project-chip/matter.js/schema');

// NOTE: This implementation assumes a standard environment setup. 
// In a real scenario, storage and detailed interaction clients need careful handling.

const app = express();
// Serve static files from current directory
// Serve static files from current directory
app.use(express.static('.'));
// Also serve at /demos/xrhome for backward compatibility with existing URLs
app.use('/demos/xrhome', express.static('.'));
app.use(cors());
app.use(bodyParser.json());

// Request Logging Middleware
app.use((req, res, next) => {
    console.log(`[HTTP] ${req.method} ${req.url}`);
    next();
});

let commissioningController = null;
const commissionedNodes = new Map(); // Store NodeId -> Device Info

// ... imports

async function startController() {
    console.log("Starting Matter Controller...");
    
    // 1. Initialize Storage
    const storageLocation = './matter-storage';
    const storage = new StorageBackendDisk(storageLocation);
    const storageManager = new StorageManager(storage);
    await storageManager.initialize();

    // 2. Initialize Matter Server
    const matterServer = new MatterServer(storageManager);

    // 3. Initialize Controller
    // configuring environment to disable IPv6
    commissioningController = new CommissioningController({
        autoConnect: false,
        // Vendor info should be in 'commissioning' options or root depending on version
        commissioning: {
            commissionerVendorId: 0x0613,
            regulatoryLocation: 0,
            regulatoryCountryCode: "US"
        }
    });
    console.log("[Controller] Initialized with Vendor ID: 0x0613");






    // 4. Add Controller to Server
    await matterServer.addCommissioningController(commissioningController);

    // 5. Start Server
    // 5. Start Server
    await matterServer.start();
    
    // --- RUNTIME PATCH FOR IPv6 (DOCKER FIX) ---
    // Moved to execute immediately after start to ensure MdnsScanner is active but before any scans.
    try {
        // Wait a tick to ensure async initialization of scanner?
        // await new Promise(resolve => setTimeout(resolve, 100));
        
        const scanner = commissioningController.mdnsScanner;
        console.log("[Patch] Checking MdnsScanner existence:", !!scanner);
        
        if (scanner) {
            console.log("[Patch] Applying IPv6 Filter to MdnsScanner...");
            
            const filterIPv6 = (device) => {
                if (!device || !device.addresses) return device;
                const isIPv6 = (ip) => ip.includes(':');
                
                let count = 0;
                if (device.addresses instanceof Map) {
                     for (const ip of device.addresses.keys()) {
                         if (isIPv6(ip)) {
                             device.addresses.delete(ip);
                             count++;
                         }
                     }
                } else if (Array.isArray(device.addresses)) {
                     const originalLen = device.addresses.length;
                     device.addresses = device.addresses.filter(addr => {
                         const ip = (typeof addr === 'string') ? addr : addr.ip;
                         return !isIPv6(ip);
                     });
                     count = originalLen - device.addresses.length;
                }
                if (count > 0) console.log(`[Patch] Filtered ${count} IPv6 addresses from device ${device.deviceIdentifier || 'unknown'}`);
                return device;
            };

            const originalFind = scanner.findOperationalDevice.bind(scanner);
            scanner.findOperationalDevice = async function(...args) {
                // console.log("[Patch] findOperationalDevice called");
                const device = await originalFind(...args);
                return filterIPv6(device);
            };
            
            // Also patch getDiscoveredOperationalDevice as PeerSet uses this in the iterator update function
            if (scanner.getDiscoveredOperationalDevice) {
                const originalGet = scanner.getDiscoveredOperationalDevice.bind(scanner);
                scanner.getDiscoveredOperationalDevice = function(...args) {
                    // console.log("[Patch] getDiscoveredOperationalDevice called");
                    const device = originalGet(...args);
                    return filterIPv6(device);
                };
            }
            
            console.log("[Patch] MdnsScanner Successfully Patched");
        } else {
            console.warn("[Patch] MdnsScanner not available on controller - Patch Skipped (IPv6 issues may persist). Check controller initialization.");
        }
    } catch (err) {
        console.error("[Patch] Failed to patch MdnsScanner:", err);
    }

    console.log("Matter Controller Started");
}

startController().catch(err => console.error("Failed to start controller:", err));

// --- API Endpoints ---

// 1. Commission (Pair) a Device
app.post('/commission', async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Missing pairing code" });

    // Sanitize code (remove dashes/spaces)
    const cleanlyCode = code.replace(/[^0-9]/g, '');

    try {
        // Output to stderr to ensure it skips stdout buffering in some docker environments
        console.error(`[Commissioning] Request Received! Code: ${cleanlyCode} (Raw: ${code})`); 
        
        let passcode;
        let shortDiscriminator;
        let longDiscriminator;

        try {
            if (typeof cleanlyCode === 'string' && cleanlyCode.length > 8) {
                // Assume Manual Pairing Code (11 or 21 digits)
                const decoded = ManualPairingCodeCodec.decode(cleanlyCode);
                passcode = decoded.passcode;
                shortDiscriminator = decoded.shortDiscriminator;
                longDiscriminator = decoded.longDiscriminator; // might be undefined for short codes
                console.log(`[Commissioning] Decoded Manual Code. Passcode: ${passcode}, Discriminator: ${shortDiscriminator}`);
            } else {
                // Short numeric code (just the PIN, typically for dev/testing)
                passcode = parseInt(cleanlyCode); 
            }
        } catch(err) {
            console.error("[Commissioning] Code Parsing Failed", err);
            return res.status(400).json({ error: "Invalid Code Format" });
        }

        // 1. Explicitly Scan for Devices first
        console.log("[Commissioning] Scanning for devices...");

        let targetDevice;
        let targetIp;

        try {
            console.log("Accessing MDNS Scanner for devices...");
            
            let devices = [];
            
            if (commissioningController.mdnsScanner) {
                const scanner = commissioningController.mdnsScanner;

                // 1. Trigger a scan
                // Reverting to simple scan as 'identifierData' caused ImplementationError
                console.log("Triggering explicit discovery (simple)...");
                commissioningController.discoverCommissionableDevices({}, 10).catch(() => {});
                
                // 2. Wait explicitly for devices to populate
                console.log("Waiting 5 seconds for MDNS results...");
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                // 3. Check records directly (Maps)
                console.log("Checking scanner.commissionableDeviceRecords...");
                if (scanner.commissionableDeviceRecords && scanner.commissionableDeviceRecords.size > 0) {
                     const records = Array.from(scanner.commissionableDeviceRecords.values());
                     devices = records;
                     console.log(`Scanner has ${devices.length} devices.`);
                }
            }

            // A. FIRST PASS: Check existing devices
            // ... (Move filtering to helper function or loop?)
            // Let's iterate `devices` currently found.
            
            const findIp = (recordList) => {
                 for (const d of recordList) {
                     // Get Addresses
                     let addresses = [];
                     if (d.addresses) {
                         if (d.addresses instanceof Map) addresses = Array.from(d.addresses.entries());
                         else if (Array.isArray(d.addresses)) addresses = (d.addresses.length > 0 && Array.isArray(d.addresses[0])) ? d.addresses : d.addresses.map(ip => [ip, {}]);
                         else if (typeof d.addresses === 'object') addresses = (d.addresses instanceof Set) ? Array.from(d.addresses).map(ip => [ip, {}]) : Object.entries(d.addresses);
                     }

                     const deviceDiscriminator = d.D !== undefined ? d.D : d.discriminator;
                     
                     let match = true;
                     if (shortDiscriminator !== undefined && deviceDiscriminator !== undefined) {
                          if (longDiscriminator !== undefined) {
                              match = (deviceDiscriminator === longDiscriminator);
                          } else {
                              const deviceShort = (deviceDiscriminator >> 8);
                              match = (deviceShort === shortDiscriminator);
                              // Log mismatch logic...
                              if (!match) console.log(`[Commissioning] Mismatch: Device ${deviceDiscriminator} (Short: ${deviceShort}) !== Target Short: ${shortDiscriminator}`);
                          }
                     }
                     
                     if (!match) continue;

                     for (const [ip, info] of addresses) {
                         if (typeof ip === 'string' && ip.includes('.') && !ip.includes(':')) {
                             return { device: d, ip: ip, port: (info && info.port) ? info.port : 5540, disc: deviceDiscriminator };
                         }
                     }
                 }
                 return null;
            };

            let found = findIp(devices);
            
            // B. RETRY: If not found, Try Targeted Discovery
            if (!found && shortDiscriminator !== undefined) {
                 console.log(`[Commissioning] Direct match failed. Retrying with TARGETED discovery for Short Disc: ${shortDiscriminator}...`);
                 
                 // Clear previous? No, just add results.
                 try {
                     await commissioningController.discoverCommissionableDevices({ 
                         identifierData: { shortDiscriminator },
                         timeoutSeconds: 5
                     }, 5); // Warning: timeoutSeconds in options vs 2nd arg
                 } catch(e) { console.log("Targeted discovery finished/timeout."); }
                 
                 // Re-check Scanner
                 if (commissioningController.mdnsScanner) {
                     const scanner = commissioningController.mdnsScanner;
                     if (scanner.commissionableDeviceRecords) {
                         const newDevices = Array.from(scanner.commissionableDeviceRecords.values());
                         console.log(`Scanner now has ${newDevices.length} devices.`);
                         found = findIp(newDevices);
                     }
                 }
            }

            if (found) {
                targetDevice = found.device;
                targetIp = found.ip;
                targetPort = found.port;
                console.log(`MATCH! Found IPv4: ${targetIp} Port: ${targetPort} for Discriminator: ${found.disc}`);
            }
 

    
        if (!targetIp) {
            console.warn("[Commissioning] No IPv4 device found after Retries. Standard commissioning WILL FAIL on IPv6.");
        } else {
             console.log(`[Commissioning] Selected Device at IP: ${targetIp}:${targetPort}`);
        }

        const commissionOptions = {
            passcode: passcode,
            addresses: [],
            discovery: {
                timeoutSeconds: 30,
                identifierData: { shortDiscriminator }
            }
        };

        // If we found an IP, force it
        if (targetIp) {
            console.log(`[Commissioning] Force-feeding IPv4 address to controller: ${targetIp}`);

            commissionOptions.ip = targetIp;
            commissionOptions.port = targetPort || 5540;

            // CLEAN UP DISCOVERY OPTIONS to prevent conflicts
            if (!commissionOptions.discovery) commissionOptions.discovery = {};

            // IMPORTANT: Remove identifierData (discriminator) if we are forcing IP.
            delete commissionOptions.discovery.identifierData;

            // Also unset longDiscriminator to avoid mismatch
            if (commissionOptions.longDiscriminator) {
                delete commissionOptions.longDiscriminator;
            }

            // Restore "Addresses" population (Scanner caching)
            commissionOptions.addresses = [{
                ip: targetIp,
                port: commissionOptions.port,
                type: 'udp'
            }];
            
            // Explicitly set knownAddress for direct connection bypass
            commissionOptions.discovery.knownAddress = { 
                type: 'udp', 
                ip: targetIp, 
                port: commissionOptions.port 
            };
        }

            // Helper to get string ID safely
            const safeId = (id) => {
                if (id === undefined || id === null) return "undefined";
                if (typeof id === 'bigint') return id.toString();
                if (typeof id === 'string') return id;
                if (typeof id === 'number') return String(id);
                
                // Check common object properties
                if (id.nodeId) return safeId(id.nodeId);
                if (id.id) return safeId(id.id);
                
                if (typeof id.toJSON === 'function') return id.toJSON().toString();
                if (typeof id.toString === 'function' && id.toString() !== '[object Object]') return id.toString();
                
                // Fallback: Try JSON stringify to see what it is
                try {
                    return JSON.stringify(id);
                } catch(e) {
                    return String(id);
                }
            };
            
            const nodeId = await commissioningController.commissionNode(commissionOptions);
            console.log("Raw Node ID Type:", typeof nodeId);
            console.log("Raw Node ID:", nodeId);
            
            const idStr = safeId(nodeId);
            console.log(`[Commissioning] Success! Node ID: ${idStr}`);
            
            // Use provided Label + Random Suffix, or fallback
            // User requested: "Name selected/suggested... with random suffix"
            const suffix = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
            const baseName = req.body.label || "Matter Device";
            const uniqueName = `${baseName}-${suffix}`;
            
            commissionedNodes.set(idStr, { 
                nodeId: idStr, 
                type: "Unknown", 
                name: uniqueName
            });

            res.json({ success: true, nodeId: idStr });

        } catch (e) {
            console.error("[Commissioning] FAILED:", e);
            if (e.stack) console.error(e.stack);
            res.status(500).json({ error: e.toString() });
        }
    } catch (e) {
        console.error("[Commissioning] Critical Error:", e);
        if (!res.headersSent) res.status(500).json({ error: e.toString() });
    }
});

// 2. List Devices
app.get('/lights', (req, res) => {
    const list = Array.from(commissionedNodes.values());
    res.json(list);
});

// 2b. Unpair/Decommission Device
app.post('/node/:id/unpair', async (req, res) => {
    const { id } = req.params;
    console.log(`[Commissioning] Requesting to unpair node: ${id}`);
    
    try {
        // Handle "Object" ID spam
        if (id === '[object Object]' || id.includes('object')) {
            console.warn(`[Commissioning] Force-removing invalid Node ID: ${id}`);
            commissionedNodes.delete(id);
            return res.json({ success: true, note: "Removed invalid entry" });
        }

        if (commissioningController) {
            // Attempt to unpair/remove
            const nodeIdBigInt = BigInt(id);
            await commissioningController.removeNode(nodeIdBigInt);
            
            commissionedNodes.delete(id);
            console.log(`[Commissioning] Unpaired node ${id}`);
            res.json({ success: true });
        } else {
            throw new Error("Controller not initialized");
        }
    } catch(e) {
        console.error("Unpair failed", e);
        // Force remove from our list anyway
        commissionedNodes.delete(id);
        res.status(500).json({ error: e.message });
    }
});

// 3. Toggle Light
app.post('/light/:id/toggle', async (req, res) => {
    const { id } = req.params;
    const { on } = req.body; // true/false

    if (id === '[object Object]' || id.includes('object')) {
         return res.status(400).json({ error: "Invalid Node ID (Corrupted). Please Unpair/Remove this device." });
    }

    try {
        // Connect to the node
        const node = await commissioningController.connectNode(BigInt(id));
        
        // Find OnOff cluster on any endpoint (Iterate devices/endpoints)
        // Note: node.getDevices() returns endpoints
        const devices = node.getDevices();
        let onOffCluster = null;
        let endpointId = -1;

        for (const device of devices) {
            // Check if this endpoint has the cluster
            const client = device.getClusterClient(OnOff.Cluster);
            if (client) {
                onOffCluster = client;
                endpointId = device.id; // Correct property? usually .number or .id
                break;
            }
        }
        
        if (!onOffCluster) {
             console.error("OnOff Cluster not found on any endpoint");
             return res.status(404).json({ error: "OnOff Cluster not found on device" });
        }
        
        console.log(`[Control] Toggling Node ${id} on Endpoint ${endpointId}`);

        if (on) {
            await onOffCluster.on();
        } else {
            await onOffCluster.off();
        }

        res.json({ success: true, endpoint: endpointId });
    } catch (e) {
        console.error("Control failed:", e);
        if (e.stack) console.error(e.stack);
        res.status(500).json({ error: e.toString() });
    }
});

// 3b. Set Brightness
app.post('/light/:id/brightness', async (req, res) => {
    const { id } = req.params;
    const { level } = req.body; // 0-254

    if (id === '[object Object]' || id.includes('object')) {
         return res.status(400).json({ error: "Invalid Node ID" });
    }

    try {
        const node = await commissioningController.connectNode(BigInt(id));
        const devices = node.getDevices();
        let levelCluster = null;

        for (const device of devices) {
            const client = device.getClusterClient(LevelControl.Cluster);
            if (client) {
                levelCluster = client;
                break;
            }
        }
        
        if (!levelCluster) {
             console.error("LevelControl Cluster not found on any endpoint");
             return res.status(404).json({ error: "LevelControl Cluster not found on device" });
        }
        
        console.log(`[Control] Setting Node ${id} Brightness to ${level}`);
        
        await levelCluster.moveToLevel({
            level: level,
            transitionTime: 0,
            optionsMask: {},
            optionsOverride: {}
        });

        res.json({ success: true });
    } catch (e) {
        console.error("Brightness control failed:", e);
        res.status(500).json({ error: e.toString() });
    }
});

// 3c. Set Color (Hue & Saturation)
app.post('/light/:id/color', async (req, res) => {
    const { id } = req.params;
    const { hue, saturation } = req.body; // 0-254 based

    if (id === '[object Object]' || id.includes('object')) {
         return res.status(400).json({ error: "Invalid Node ID" });
    }

    try {
        const node = await commissioningController.connectNode(BigInt(id));
        const devices = node.getDevices();
        let colorCluster = null;

        for (const device of devices) {
            const client = device.getClusterClient(ColorControl.Cluster);
            if (client) {
                colorCluster = client;
                break;
            }
        }
        
        if (!colorCluster) {
             console.error("ColorControl Cluster not found on any endpoint");
             return res.status(404).json({ error: "ColorControl Cluster not found on device" });
        }
        
        console.log(`[Control] Setting Node ${id} Color Hue: ${hue}, Saturation: ${saturation}`);
        
        await colorCluster.moveToHueAndSaturation({
            hue,
            saturation,
            transitionTime: 0,
            optionsMask: {},
            optionsOverride: {}
        });

        res.json({ success: true });
    } catch (e) {
        console.error("Color control failed:", e);
        res.status(500).json({ error: e.toString() });
    }
});

// 4. Get Light State (Polling)
app.get('/light/:id/state', async (req, res) => {
    const { id } = req.params;
    
    if (id === '[object Object]' || id.includes('object')) {
         return res.status(400).json({ error: "Invalid Node ID" });
    }

    try {
        const node = await commissioningController.connectNode(BigInt(id));
        const devices = node.getDevices();
        let onOffCluster = null;

        for (const device of devices) {
            const client = device.getClusterClient(OnOff.Cluster);
            if (client) {
                onOffCluster = client;
                break;
            }
        }
        
        if (!onOffCluster) {
             return res.status(404).json({ error: "OnOff Cluster not found" });
        }

        // Read Attribute
        // Pattern: client.attributes.attributeName.get()
        let isOn = false;
        if (onOffCluster.attributes && onOffCluster.attributes.onOff) {
             isOn = await onOffCluster.attributes.onOff.get(); 
        } else if (onOffCluster.getOnOffAttribute) {
             // Fallback for older versions?
             isOn = await onOffCluster.getOnOffAttribute();
        } else {
             console.warn("Could not find OnOff attribute on cluster client");
             // Fallback to false or check generic
        }
        
        // Ensure boolean
        if (typeof isOn === 'object' && isOn !== null) {
            // Unpack if it returns object { value: ... }
            isOn = isOn.value;
        }

        console.log(`[State] Node ${id} is ${isOn ? 'ON' : 'OFF'}`);
        
        res.json({ success: true, is_on: isOn });

    } catch (e) {
        console.error("State check failed:", e);
        res.status(500).json({ error: e.toString() });
    }
});

const PORT = 8080;
// HTTPS Setup
const https = require('https');
const fs = require('fs');

try {
    const options = {
        key: fs.readFileSync('key.pem'),
        cert: fs.readFileSync('cert.pem')
    };

    https.createServer(options, app).listen(PORT, () => {
        console.log(`Matter Controller & Web Server running on https://localhost:${PORT}`);
    });
} catch (e) {
    console.error("Failed to start HTTPS Server. Missing key.pem or cert.pem?", e.message);
    console.log("Falling back to HTTP...");
    app.listen(PORT, () => {
         console.log(`Matter Controller & Web Server running on http://localhost:${PORT}`);
    });
}
