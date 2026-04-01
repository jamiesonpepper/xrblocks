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
        try {
            // Mapping 0-100 percentage to Matter's 0-254 level format
            const level = Math.round((Math.max(0, Math.min(100, val)) / 100) * 254);
            await fetch(`${this.baseUrl}/light/${deviceId}/brightness`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ level })
            });
        } catch (e) {
            console.error("Failed to set matter light brightness", e);
        }
    }

    async setColor(deviceId, hexColor) {
        try {
            // 1. Convert HEX to HSL
            let r = 0, g = 0, b = 0;
            if (hexColor.length === 4) {
              r = "0x" + hexColor[1] + hexColor[1];
              g = "0x" + hexColor[2] + hexColor[2];
              b = "0x" + hexColor[3] + hexColor[3];
            } else if (hexColor.length === 7) {
              r = "0x" + hexColor[1] + hexColor[2];
              g = "0x" + hexColor[3] + hexColor[4];
              b = "0x" + hexColor[5] + hexColor[6];
            }
            // rgb parsing
            r /= 255;
            g /= 255;
            b /= 255;
            let cmin = Math.min(r,g,b),
                cmax = Math.max(r,g,b),
                delta = cmax - cmin,
                h = 0,
                s = 0,
                l = 0;
          
            if (delta == 0) h = 0;
            else if (cmax == r) h = ((g - b) / delta) % 6;
            else if (cmax == g) h = (b - r) / delta + 2;
            else h = (r - g) / delta + 4;
            h = Math.round(h * 60);
            if (h < 0) h += 360;
            l = (cmax + cmin) / 2;
            s = delta == 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
            
            // Matter Hue is 0 - 254 (mapped from 0-360 degrees)
            const matterHue = Math.round((h / 360) * 254);
            
            // Matter Saturation is 0 - 254 (mapped from 0-1.0 float)
            const matterSat = Math.round(s * 254);

            await fetch(`${this.baseUrl}/light/${deviceId}/color`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ hue: matterHue, saturation: matterSat })
            });

        } catch (e) {
            console.error("Failed to set matter light color", e);
        }
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
