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
        };

        this.ws.onmessage = (event) => {
            this.handleMessage(event.data);
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
                tools: [{ 
                    function_declarations: [{
                        name: "report_found_lights",
                        description: "Report the location of lights or lamps found in the video stream.",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                lights: {
                                    type: "ARRAY",
                                    items: {
                                        type: "OBJECT",
                                        properties: {
                                            label: { type: "STRING", description: "The type of light (e.g. lamp, overhead)" },
                                            ymin: { type: "NUMBER", description: "Top Y coordinate (0-1)" },
                                            xmin: { type: "NUMBER", description: "Left X coordinate (0-1)" },
                                            ymax: { type: "NUMBER", description: "Bottom Y coordinate (0-1)" },
                                            xmax: { type: "NUMBER", description: "Right X coordinate (0-1)" }
                                        },
                                        required: ["label", "ymin", "xmin", "ymax", "xmax"]
                                    }
                                }
                            },
                            required: ["lights"]
                        }
                    }]
                }],
                // generation_config: {
                //    response_modalities: ["TEXT"] // Relax this, let it send Audio if it wants, we just ignore/log it for now.
                // },
                system_instruction: {
                    parts: [{
                        text: "You are a Light Detector. Call 'report_found_lights' when you see lights. Do not chat."
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
        // console.log("Sending chunk:", mimeType, base64Data.length); // Verbose

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

            // Handle Tool Calls (The "Function Call")
            if (response.serverContent && response.serverContent.modelTurn) {
                const parts = response.serverContent.modelTurn.parts;
                for (const part of parts) {
                    if (part.text) {
                        console.log("Gemini Text:", part.text);
                        if (this.onMessage) this.onMessage(part.text);
                    }
                    if (part.functionCall) {
                        console.log("Gemini Function Call:", part.functionCall);
                        if (part.functionCall.name === "report_found_lights") {
                            const args = part.functionCall.args;
                            if (this.onLightsFound && args.lights) {
                                this.onLightsFound(args.lights);
                            }
                            
                            // Acknowledge the function call to keep the conversation going
                            this.sendToolResponse(part.functionCall.id || "function-call-id", "Lights recorded."); 
                        }
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
