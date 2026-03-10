/**
 * webrtc.js
 * Handles Camera access and frame capture.
 */

export class CameraManager {
    constructor(videoElementId) {
        this.videoElement = document.getElementById(videoElementId);
        this.stream = null;
        this.processor = null;
        this.source = null;
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
                audio: false // Disabled per user request
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

    async captureFrame(canvasElement) {
        if (!this.stream) return null;

        const ctx = canvasElement.getContext('2d');
        let width = 640;
        let height = 480;

        if (this.videoElement && this.videoElement.readyState >= 2) {
            // We ONLY use Video Element fallback for 2D Desktop compatibility
            const scale = 640 / this.videoElement.videoWidth;
            width = 640;
            height = this.videoElement.videoHeight * scale;
            
            canvasElement.width = width;
            canvasElement.height = height;
            ctx.drawImage(this.videoElement, 0, 0, canvasElement.width, canvasElement.height);
        } else {
            return null;
        }
        
        // Return Blob for API upload
        return new Promise(resolve => {
            canvasElement.toBlob(blob => resolve(blob), 'image/jpeg', 0.8);
        });
    }


        // Removed Audio Processing completely per user request
}
