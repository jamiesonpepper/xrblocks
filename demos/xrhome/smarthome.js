/**
 * smarthome.js
 * Handles Google Home Device Access API.
 */

export class SmartHomeManager {
    constructor(authManager) {
        this.auth = authManager;
        this.baseUrl = 'https://smartdevicemanagement.googleapis.com/v1';
    }

    async listDevices() {
        const projectId = this.auth.config.projectId;
        if (!projectId) throw new Error("No Project ID configured");

        const url = `${this.baseUrl}/enterprises/${projectId}/devices`;
        
        const response = await fetch(url, {
            method: 'GET',
            headers: this.auth.getHeaders()
        });

        if (!response.ok) {
           throw new Error(`SDM API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.devices || [];
    }

    async toggleLight(deviceId, turnOn) {
        const url = `${this.baseUrl}/${deviceId}:executeCommand`;
        
        const command = "sdm.devices.commands.OnOff.SetOnOff";
        const params = { on: turnOn };

        const response = await fetch(url, {
            method: 'POST',
            headers: this.auth.getHeaders(),
            body: JSON.stringify({
                command: command,
                params: params
            })
        });

       if (!response.ok) {
           console.error("Failed to toggle light", await response.text());
        }
    }

    async setBrightness(deviceId, brightnessPercent) {
        // Brightness is usually 0-100? Or depends on trait. 
        // Trait: sdm.devices.traits.Brightness -> command: sdm.devices.commands.Brightness.SetBrightness -> params: brightnessPercent (integer)
        
        const url = `${this.baseUrl}/${deviceId}:executeCommand`;
        const command = "sdm.devices.commands.Brightness.SetBrightness";
        const params = { brightnessPercent: Math.round(brightnessPercent) };

        const response = await fetch(url, {
            method: 'POST',
            headers: this.auth.getHeaders(),
            body: JSON.stringify({
                command: command,
                params: params
            })
        });

       if (!response.ok) {
           console.error("Failed to set brightness", await response.text());
        }
    }
}
