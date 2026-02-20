/**
 * vision.js
 * Handles interaction with Gemini 1.5 Flash REST API.
 * Uses strict JSON mode for reliable object detection.
 */

export class VisionManager {
    constructor() {
        this.apiKey = null;
        this.isScanning = false;
        this.onLightsFound = null; // Callback(lights[])
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

            // Switching to Gemini 2.0 Flash (Stable)
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`;
            
            console.log(`[Vision] Sending Request to Gemini...`);
            
            const payload = {
                contents: [{
                    parts: [
                        { text: "Analyze this image from a wide-angle room camera. Find all light sources (lamps, ceiling lights, bulbs, strips) even if they are small, distant, or currently turned OFF. Look carefully for lamp shades, recessed lights, and fixtures. Return a JSON array of objects with keys: label, ymin, xmin, ymax, xmax. Coordinates are normalized 0-1. If none, return empty array." },
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
                const lights = JSON.parse(jsonText);
                
                console.log(`[Vision] Parsed Lights: ${lights.length} found.`);
                if (this.onLightsFound) this.onLightsFound(lights, cameraMatrix); // Pass Matrix Back
                if (this.onStatus) this.onStatus(`Found ${lights.length} lights`);
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
