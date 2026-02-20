/**
 * webrtc.js
 * Handles Camera access and frame capture.
 */

export class CameraManager {
    constructor(videoElementId) {
        this.videoElement = document.getElementById(videoElementId);
        this.stream = null;
        this.imageCapture = null; // New: ImageCapture API support
        this.audioContext = null;
        this.processor = null;
        this.source = null;
        this.onAudioData = null; // Callback
    }

    async startCamera() {
        try {
            // Request camera (back facing if available, else user)
            const constraints = {
                video: {
                    facingMode: 'environment', // prioritized
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: true
            };

            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.videoElement.srcObject = this.stream;
            
            // Setup ImageCapture for robust frame grabbing (works even if video paused in XR)
            const track = this.stream.getVideoTracks()[0];
            if (track && window.ImageCapture) {
                this.imageCapture = new ImageCapture(track);
                console.log("CameraManager: ImageCapture API initialized.");
            }
            
            return new Promise((resolve) => {
                this.videoElement.onloadedmetadata = () => {
                    this.videoElement.play(); // Play for 2D/Debug visibility
                    resolve();
                };
            });
        } catch (e) {
            console.error("Error accessing camera:", e);
            throw e;
        }
    }
    async captureFrame(canvasElement) {
        let bitmap = null;
        
        // Method 1: ImageCapture (Preferred for XR/Background)
        // Check availability automatically
        if (this.imageCapture) {
            try {
                // Timeout set to 250ms, interleaved with main loop (300ms) to allow cooldown
                const grabPromise = this.imageCapture.grabFrame();
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 250));
                
                bitmap = await Promise.race([grabPromise, timeoutPromise]);
                // console.log("[Cam] ImageCapture Success");
            } catch (e) {
                 const msg = e ? (e.message || e) : "Unknown Error";
                 console.warn(`[Cam] ImageCapture Failed/Timeout: ${msg}`);
                 // Fallback to Video Element below
            }
        }

        const ctx = canvasElement.getContext('2d');
        let source = bitmap;
        let originalWidth = bitmap ? bitmap.width : 0;
        let originalHeight = bitmap ? bitmap.height : 0;

        // Method 2: Fallback to Video Element
        if (!source) {
            if (!this.stream || !this.videoElement) return null;
            
            const vid = this.videoElement;

            // Simple check: Is video ready?
            if (vid.readyState < 2) return null;
            
            // NOTE: We don't force .play() here anymore to avoid conflicts with XR Session
            source = vid;
            originalWidth = vid.videoWidth;
            originalHeight = vid.videoHeight;
        }

        if (!originalWidth) return null;

        // Up-scale to 1024px width for better detection
        const targetWidth = 1024;
        const scale = targetWidth / originalWidth;
        
        canvasElement.width = targetWidth;
        canvasElement.height = originalHeight * scale;
        
        // Clear before draw
        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        ctx.drawImage(source, 0, 0, canvasElement.width, canvasElement.height);
        
        // Return Blob for API upload
        return new Promise(resolve => {
            canvasElement.toBlob(blob => resolve(blob), 'image/jpeg', 0.8);
        });
    }


    // Start capturing raw PCM audio for Live API
    async startAudioStream(callback) {
        if (!this.stream) return;
        this.onAudioData = callback;

        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        
        try {
            await this.audioContext.audioWorklet.addModule('audio-processor.js');
        } catch (e) {
            console.error("Failed to load audio worklet", e);
            return;
        }

        this.source = this.audioContext.createMediaStreamSource(this.stream);
        this.processor = new AudioWorkletNode(this.audioContext, 'metrics-processor');

        this.processor.port.onmessage = (e) => {
            const inputData = e.data;
             // Convert Float32 to Int16 PCM
            const pcmData = this.floatTo16BitPCM(inputData);
            
            // Convert to Base64 for Gemini
            const base64 = this.arrayBufferToBase64(pcmData);
            if (this.onAudioData) this.onAudioData(base64);
        };

        this.source.connect(this.processor);
        this.processor.connect(this.audioContext.destination);
    }

    stopAudioStream() {
        if (this.processor) {
            this.processor.disconnect();
            this.processor = null;
        }
        if (this.source) {
            this.source.disconnect();
            this.source = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }

    floatTo16BitPCM(output) {
        const buffer = new ArrayBuffer(output.length * 2);
        const view = new DataView(buffer);
        for (let i = 0; i < output.length; i++) {
            let s = Math.max(-1, Math.min(1, output[i]));
            // s = s < 0 ? s * 0x8000 : s * 0x7FFF;
             s = s < 0 ? s * 0x8000 : s * 0x7FFF;
            view.setInt16(i * 2, s, true); // Little Endian
        }
        return buffer;
    }

    arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }
}
