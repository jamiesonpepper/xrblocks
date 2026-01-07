/**
 * webrtc.js
 * Handles Camera access and frame capture.
 */

export class CameraManager {
    constructor(videoElementId) {
        this.videoElement = document.getElementById(videoElementId);
        this.stream = null;
        this.audioContext = null;
        this.processor = null;
        this.source = null;
        this.onAudioData = null; // Callback
    }

    async startCamera() {
        try {
            // Request camera (back facing if available, else user)
            // Ideally 'environment' for AR, but 'user' for "Front Facing" as requested?
            // "front facing camera(s) in an XR headset" usually means the world-facing cameras.
            // On a phone, that's 'environment'. On a laptop, it's 'user'.
            // Let's try 'environment' first, fall back to 'user'.
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
            
            return new Promise((resolve) => {
                this.videoElement.onloadedmetadata = () => {
                    this.videoElement.play(); // Explicitly play to ensure frames are rendering
                    resolve();
                };
            });
        } catch (e) {
            console.error("Error accessing camera:", e);
            throw e;
        }
    }

    captureFrame(canvasElement) {
        if (!this.stream || !this.videoElement) return null;

        const ctx = canvasElement.getContext('2d');
        // Downscale to 640px width for bandwidth efficiency / API preferred size
        const scale = 640 / this.videoElement.videoWidth;
        canvasElement.width = 640;
        canvasElement.height = this.videoElement.videoHeight * scale;
        
        ctx.drawImage(this.videoElement, 0, 0, canvasElement.width, canvasElement.height);
        
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
