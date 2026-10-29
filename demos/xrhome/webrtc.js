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
            // Progressive constraints: Prefer environment, but support user / glasses / external cameras
            const constraints = {
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false // Disabled per user request
            };

            // If permissions were previously granted, enumerate devices to pick the best physical camera
            try {
                if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === 'function') {
                    const devices = await navigator.mediaDevices.enumerateDevices();
                    const videoInputs = devices.filter(d => d.kind === 'videoinput');
                    if (videoInputs.length > 1) {
                        const isQuest = /Quest|Oculus/i.test(navigator.userAgent);
                        const isAndroid = /Android/i.test(navigator.userAgent);
                        let bestDev = null;
                        let highestScore = -Infinity;
                        for (const dev of videoInputs) {
                            const lbl = (dev.label || '').toLowerCase();
                            let score = 0;
                            if (lbl.includes('avatar') || lbl.includes('virtual') || lbl.includes('dummy')) score -= 100;
                            if (lbl.includes('environment') || lbl.includes('back') || lbl.includes('world') || lbl.includes('passthrough')) score += isQuest ? 60 : 30;
                            if (lbl.includes('rgb') || lbl.includes('xreal') || lbl.includes('aura') || lbl.includes('glasses')) score += 50;
                            if (isAndroid && !isQuest && (lbl.includes('front') || lbl.includes('camera 0'))) score += 25;
                            if (dev.label) score += 5;
                            if (score > highestScore) {
                                highestScore = score;
                                bestDev = dev;
                            }
                        }
                        if (bestDev && bestDev.deviceId) {
                            constraints.video.deviceId = { ideal: bestDev.deviceId };
                        }
                    }
                }
            } catch (enumErr) {
                console.warn("[CameraManager] Pre-enumeration check:", enumErr);
            }

            try {
                this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            } catch (strictErr) {
                console.warn("[CameraManager] Ideal constraint getUserMedia failed, retrying with basic video constraint:", strictErr);
                this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            }
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
