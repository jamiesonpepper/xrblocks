/**
 * gemini.js
 * Handles interaction with Google Gemini Multimodal Live API (WebSocket).
 */

export class GeminiManager {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.onMessage = null; // Callback for text response
        this.onLightsFound = null; // Callback for function calls
    }

    connect(apiKey) {
        if (this.ws) {
            this.disconnect();
        }

        const cleanKey = apiKey.trim();
        const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${cleanKey}`;
        console.log("Connecting to Gemini Live API:", url);

        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            console.log("Gemini Live Connected");
            this.isConnected = true;
            this.sendSetup();
            // Kickstart conversation after a brief delay for setup to process
            setTimeout(() => {
                this.sendText("System Ready. Please describe what you see in the video stream inside the room.");
            }, 1000);
        };

        this.ws.onmessage = async (event) => {
            let data = event.data;
            if (data instanceof Blob) {
               // Binary Audio response. 
               // Do NOT update HUD (User requested less noise). 
               // Just log to console so we know it happened.
               console.log("Gemini sent Audio Blob (ignored by HUD)");
               return; 
            }
            this.handleMessage(data);
        };

        this.ws.onerror = (err) => {
            console.error("Gemini Live Error:", err);
            this.isConnected = false;
        };

        this.ws.onclose = (event) => {
            console.log(`Gemini Live Disconnected. Code: ${event.code}, Reason: ${event.reason}`);
            this.isConnected = false;
        };
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    sendSetup() {
        const setupMsg = {
            setup: {
                model: "models/gemini-2.0-flash-exp",
                // Tools and Tool Config removed to simplify - using pure Text Prompting which is often more reliable for "Vision to Struct" in v2-exp
                generation_config: {
                    response_modalities: ["TEXT"],
                    temperature: 0.1 // Low temperature for deterministic JSON
                },
                system_instruction: {
                    parts: [{
                        text: "You are a Vision System. Analyze the video stream for light sources (lamps, ceiling lights). \
If you see lights, output their 2D bounding boxes as a strictly valid JSON array prefixed with 'JSON_LIGHTS:'. \
Format: JSON_LIGHTS: [{\"label\": \"lamp\", \"ymin\": 0.1, \"xmin\": 0.1, \"ymax\": 0.2, \"xmax\": 0.2}, ...]\
If you see no lights, simply output 'NO_LIGHTS'. \
DO NOT CHAT. DO NOT SPEAK. ONLY OUTPUT JSON."
                    }]
                }
            }
        };
        this.ws.send(JSON.stringify(setupMsg));
    }

    sendText(text) {
        if (!this.isConnected || !this.ws) return;
        const msg = {
             client_content: {
                 turns: [{
                     role: "user",
                     parts: [{ text: text }]
                 }],
                 turn_complete: true
             }
        };
        this.ws.send(JSON.stringify(msg));
    }

    // Send Realtime Input (Audio or Video)
    // Data must be base64 string
    // MimeType: 'audio/pcm;rate=16000' or 'image/jpeg'
    sendChunk(base64Data, mimeType) {
        if (!this.isConnected || !this.ws) return;
        
        // Debug: Log video size occasionally to prove it's sending
        if (mimeType.startsWith('image') && Math.random() < 0.05) {
             console.log("Sending Video Frame, size: " + base64Data.length);
        }

        const msg = {
            realtime_input: {
                media_chunks: [{
                    mime_type: mimeType,
                    data: base64Data
                }]
            }
        };
        this.ws.send(JSON.stringify(msg));
    }

    handleMessage(data) {
        try {
            const response = JSON.parse(data);
            
            // Log for debug to see why it's ignoring tools
            // console.log("Gemini Raw:", JSON.stringify(response).substring(0, 200) + "..."); 
            
            // Debug: Log if turn complete but empty?
            if (response.serverContent) {
                 console.log("Gemini Server Content Type:", Object.keys(response.serverContent));
            } 

            // Handle Text Responses (including embedded JSON)
            if (response.serverContent && response.serverContent.modelTurn) {
                const parts = response.serverContent.modelTurn.parts;
                for (const part of parts) {
                    if (part.text) {
                        const txt = part.text.trim();
                        console.log("Gemini Text:", txt);
                        
                        // 1. Check for JSON_LIGHTS prefix
                        if (txt.includes("JSON_LIGHTS:")) {
                            try {
                                const jsonStr = txt.split("JSON_LIGHTS:")[1].trim().replace(/```json/g, '').replace(/```/g, '');
                                const lights = JSON.parse(jsonStr);
                                if (this.onLightsFound) this.onLightsFound(lights);
                                if (this.onMessage) this.onMessage("FOUND " + lights.length + " LIGHTS", '#00FFFF');
                                return; // Done
                            } catch (e) {
                                console.error("Failed to parse JSON_LIGHTS", e);
                            }
                        }
                        
                        // 1b. Fallback: Check if message STARTs with JSON array (sometimes prefix is lost)
                        if (txt.trim().startsWith("[") && txt.includes("label")) {
                             try {
                                const jsonStr = txt.trim().replace(/```json/g, '').replace(/```/g, '');
                                const lights = JSON.parse(jsonStr);
                                if (this.onLightsFound) this.onLightsFound(lights);
                                if (this.onMessage) this.onMessage("FOUND " + lights.length + " LIGHTS", '#00FFFF');
                                return;
                            } catch (e) { }
                        }

                        // 2. Otherwise just show text
                        if (this.onMessage) this.onMessage(txt);
                    }
                }
            }
            
            // Handle Tool Call (Alternative format depending on API version, sometimes in separate field)
            if (response.toolCall) {
                 console.log("Gemini Top-Level Tool Call:", response.toolCall);
                 // ... handle if schema differs, but usually it's in modelTurn
            }

        } catch (e) {
            console.error("Error parsing Gemini message:", e);
        }
    }

    sendToolResponse(id, resultText) {
         const msg = {
            tool_response: {
                function_responses: [{
                    id: id,
                    name: "report_found_lights",
                    response: { result: { status: "success", info: resultText } }
                }]
            }
        };
        this.ws.send(JSON.stringify(msg));
    }

    blobToBase64(blob) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.readAsDataURL(blob);
        });
    }
}
