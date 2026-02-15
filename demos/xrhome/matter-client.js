export class MatterClient {
    constructor() {
        // Use relative path so it works on localhost OR network IP
        this.baseUrl = '';  
    }

    async listDevices() {
        const url = `${this.baseUrl}/lights`;
        try {
            console.log(`[MatterClient] Fetching: ${url}`);
            const response = await fetch(url);
            
            if (!response.ok) {
                console.error(`[MatterClient] Error ${response.status}: ${response.statusText}`);
                const text = await response.text();
                // console.error(`[MatterClient] Response:`, text);
                throw new Error(`HTTP ${response.status}`);
            }
            
            const devices = await response.json();
            return devices.map(d => ({
                name: d.name,
                type: 'LIGHT', 
                id: d.nodeId,
                origin: 'MATTER',
                traits: { "sdm.devices.traits.Info": { customName: d.label || d.name || "Matter Device" } } 
            }));
            // return []; // Disabled by user request
        } catch (e) {
            console.error("[MatterClient] List Failed:", e);
            // Don't swallow, let main.js handle but return empty to survive
            return [];
        }
    }

    async toggleLight(deviceId, turnOn) {
        try {
            await fetch(`${this.baseUrl}/light/${deviceId}/toggle`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ on: turnOn })
            });
        } catch (e) {
            console.error("Failed to toggle matter light", e);
        }
    }

    async getLightState(deviceId) {
        try {
            const response = await fetch(`${this.baseUrl}/light/${deviceId}/state`);
            if (response.ok) {
                const data = await response.json();
                return data.is_on; // true/false
            }
        } catch (e) {
            console.error("Failed to get light state", e);
        }
        return null; // Unknown
    }

    async setBrightness(deviceId, val) {
        // TODO: Implement LevelControl in backend
        console.warn("Brightness not yet implemented in Matter Backend");
    }

    async unpairDevice(deviceId) {
        try {
            console.log(`[MatterClient] Unpairing ${deviceId}...`);
            await fetch(`${this.baseUrl}/node/${deviceId}/unpair`, {
                method: 'POST'
            });
            return true;
        } catch (e) {
            console.error("Unpair failed", e);
            return false;
        }
    }

    async commissionDevice(code, label) {
        try {
            const response = await fetch(`${this.baseUrl}/commission`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ code, label })
            });
            return await response.json();
        } catch (e) {
            console.error("Commissioning failed", e);
            return { error: e.message };
        }
    }
}

export const matterClient = new MatterClient();
