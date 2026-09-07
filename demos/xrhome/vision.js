/**
 * vision.js
 * Handles interaction with Gemini 2.5 Flash REST API.
 * Uses strict JSON mode for reliable object detection.
 */

export class VisionManager {
    constructor() {
        this.apiKey = null;
        this.isScanning = false;
        this.onDevicesFound = null; // Callback(devices[])
        this.onStatus = null; // Callback(text)
    }

    init(apiKey) {
        this.apiKey = apiKey;
    }

    /**
     * Captures a frame and sends it to Gemini 1.5 Flash.
     * @param {Blob} imageBlob - JPEG output from CameraManager
     * @param {THREE.Matrix4} [cameraMatrix] - Optional camera pose at time of capture
     */
    async analyzeFrame(imageBlob, cameraMatrix = null) {
        if (!this.apiKey || this.isScanning) return;
        
        this.isScanning = true;
        if (this.onStatus) this.onStatus("Scanning...");

        try {
            // Convert Blob to Base64
            const base64Data = await this.blobToBase64(imageBlob);
            console.log(`[Vision] Encoded Frame Size: ${base64Data.length} chars (~${Math.round(base64Data.length/1024)} KB)`);
            console.log('[Vision] RAW_BASE64_IMAGE_START');
            console.log(base64Data);
            console.log('[Vision] RAW_BASE64_IMAGE_END');

            // Switching to Gemini 2.5 Flash (Stable)
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.apiKey}`;
            
            console.log(`[Vision] Sending Request to Gemini...`);
            
            const payload = {
                contents: [{
                    parts: [
                        { text: "Analyze this image from a wide-angle room camera. Find all rigid Smart Home appliances (switches, Smart TV's, appliances, and smart bulbs in lamps, ceiling, lights and elsewhere) even if they are currently turned OFF. Look carefully for any visible devices. Return a JSON array of objects with keys: label, ymin, xmin, ymax, xmax. Coordinates are normalized 0-1. If none, return empty array." },
                        {
                            inline_data: {
                                mime_type: "image/jpeg",
                                data: base64Data
                            }
                        }
                    ]
                }],
                generation_config: {
                    response_mime_type: "application/json",
                    response_schema: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                label: { type: "STRING" },
                                ymin: { type: "NUMBER" },
                                xmin: { type: "NUMBER" },
                                ymax: { type: "NUMBER" },
                                xmax: { type: "NUMBER" }
                            },
                            required: ["label", "ymin", "xmin", "ymax", "xmax"]
                        }
                    }
                }
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                console.error(`[Vision] API Error Status: ${response.status} ${response.statusText}`);
                const errorText = await response.text();
                console.error(`[Vision] API Error Body: ${errorText}`);
                throw new Error(`API Error: ${response.status}`);
            }

            const data = await response.json();
            console.log(`[Vision] Response Received:`, data);
            
            // Parse Result
            if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts[0].text) {
                const jsonText = data.candidates[0].content.parts[0].text;
                const devices = JSON.parse(jsonText);
                
                console.log(`[Vision] Parsed Devices: ${devices.length} found.`);
                if (this.onDevicesFound) this.onDevicesFound(devices, cameraMatrix);
                if (this.onLightsFound) this.onLightsFound(devices, cameraMatrix);
                if (this.onStatus) this.onStatus(`Found ${devices.length} devices`);
            } else {
                console.warn(`[Vision] No candidates in response.`);
                if (this.onStatus) this.onStatus("No result");
            }

        } catch (e) {
            console.error("Vision API Failed:", e);
            if (this.onStatus) this.onStatus("Error: " + e.message);
        } finally {
            this.isScanning = false;
        }
    }

    blobToBase64(blob) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.readAsDataURL(blob);
        });
    }
}
