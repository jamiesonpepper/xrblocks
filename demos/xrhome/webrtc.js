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
                    this.videoElement.play(); // Explicitly play
                    
                    // Force continuous rendering to prevent WebXR from suspending the video frame buffer!
                    const keepAliveCanvas = document.createElement('canvas');
                    keepAliveCanvas.width = 1; keepAliveCanvas.height = 1;
                    const keepAliveCtx = keepAliveCanvas.getContext('2d', { alpha: false });
                    const keepAliveLoop = () => {
                        if (this.videoElement.readyState >= 2 && !this.videoElement.paused) {
                            keepAliveCtx.drawImage(this.videoElement, 0, 0, 1, 1);
                        }
                        requestAnimationFrame(keepAliveLoop);
                    };
                    keepAliveLoop();
                    
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

        // Ensure playback isn't suspended by WebXR overlay
        if (this.videoElement.paused) {
            try { await this.videoElement.play(); } catch(e){}
        }

        // Wait for video frame to advance to prevent stale initial FoV (Headset Freeze Fix)
        const startIdx = this.videoElement.currentTime;
        let attempts = 0;
        while(this.videoElement.currentTime === startIdx && attempts < 10) {
            await new Promise(r => setTimeout(r, 50));
            attempts++;
        }

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
