import * as THREE from 'three';
import * as xb from 'xrblocks';

export class EasterEggManager extends xb.Script {
    constructor(getDeps) {
        super();
        this.lastTriggerTime = 0;
        this.getDeps = getDeps;
    }

    update() {
        if (!xb.core || !xb.core.user || !xb.core.user.hands || !xb.core.user.hands.hands) return;
        
        const now = Date.now();
        if (now - this.lastTriggerTime < 1000) return;
        
        for (let i = 0; i < xb.core.user.hands.hands.length; i++) {
            const hand = xb.core.user.hands.hands[i];
            if (hand && hand.joints && this.isRockGesture(hand.joints)) {
                this.triggerEasterEgg();
                this.lastTriggerTime = now;
                break;
            }
        }
    }

    isRockGesture(joints) {
        const wrist = joints["wrist"];
        const indexTip = joints["index-finger-tip"];
        const middleTip = joints["middle-finger-tip"];
        const ringTip = joints["ring-finger-tip"];
        const pinkyTip = joints["pinky-finger-tip"];

        if (!wrist || !indexTip || !middleTip || !ringTip || !pinkyTip) return false;

        const wPos = wrist.position;
        const dIndex = wPos.distanceTo(indexTip.position);
        const dMiddle = wPos.distanceTo(middleTip.position);
        const dRing = wPos.distanceTo(ringTip.position);
        const dPinky = wPos.distanceTo(pinkyTip.position);

        const maxCurled = Math.max(dMiddle, dRing);
        const minExtended = Math.min(dIndex, dPinky);

        return (minExtended > maxCurled * 1.4) && (minExtended - maxCurled > 0.04);
    }

    triggerEasterEgg() {
        console.log("🎸 ROCK GESTURE DETECTED! Triggering Easter Egg!");
        const { virtualLights, smartHome, hud, VirtualLight3D } = this.getDeps();
        let triggered = false;

        virtualLights.forEach(vl => {
            if (vl.realDevice && vl.isOn && vl instanceof VirtualLight3D) {
                const hue = Math.floor(Math.random() * 360);
                const colorHex = '#' + new THREE.Color(`hsl(${hue}, 100%, 65%)`).getHexString();
                
                vl.stateColor = colorHex;
                vl.rebuildPanel();
                triggered = true;
                
                if (smartHome && smartHome.setColor) {
                    smartHome.setColor(vl.realDevice.id, colorHex);
                }
            }
        });

        if (triggered && hud) {
            hud.log("Rock On! Colors randomized.", "#FF00FF");
        }
    }
}

export class BrightnessManager extends xb.Script {
    constructor(getDeps) {
        super();
        this.gestureState = 'IDLE';
        this.baseY = 0;
        this.baseBrightness = 100;
        this.throttle = 0;
        this.getDeps = getDeps;
    }
    
    update() {
        if (!xb.core || !xb.core.user || !xb.core.user.hands || !xb.core.user.hands.hands) return;
        
        const { virtualLights } = this.getDeps();
        let foundThumbTracking = false;
        
        for (let i = 0; i < xb.core.user.hands.hands.length; i++) {
            const hand = xb.core.user.hands.hands[i];
            if (!hand || !hand.joints) continue;
            
            const wrist = hand.joints["wrist"];
            const thumbTip = hand.joints["thumb-tip"];
            const indexTip = hand.joints["index-finger-tip"];
            const pinkyTip = hand.joints["pinky-finger-tip"];
            
            if (!wrist || !thumbTip || !indexTip || !pinkyTip) continue;
            
            const wPos = wrist.position;
            const dIndex = wPos.distanceTo(indexTip.position);
            const dPinky = wPos.distanceTo(pinkyTip.position);
            
            const maxCurled = Math.max(dIndex, dPinky);
            const isFistCurled = (maxCurled < 0.08); 
            
            const dThumb = wPos.distanceTo(thumbTip.position);
            const isThumbExtended = (dThumb > 0.10);
            
            if (isFistCurled && !isThumbExtended && this.gestureState === 'IDLE') {
                this.gestureState = 'FIST_DETECTED';
                console.log("✊ BRIGHTNESS CONTROL READY (Fist Detected)");
            } else if (isFistCurled && isThumbExtended && this.gestureState === 'FIST_DETECTED') {
                 this.gestureState = 'THUMB_TRACKING';
                 this.baseY = thumbTip.position.y;
                 
                 let totalB = 0, count = 0;
                 virtualLights.forEach(vl => { if(vl.realDevice && vl.isOn) { totalB += vl.brightness; count++;} });
                 this.baseBrightness = count > 0 ? (totalB / count) : 100;
                 console.log("👍 THUMB TRACKING STARTED (BaseY: " + this.baseY.toFixed(2) + ", BaseBr: " + this.baseBrightness + ")");
            } else if (isFistCurled && isThumbExtended && this.gestureState === 'THUMB_TRACKING') {
                 foundThumbTracking = true;
                 
                 this.throttle++;
                 if (this.throttle > 10) {
                     this.throttle = 0;
                     const currentY = thumbTip.position.y;
                     const deltaY = currentY - this.baseY;
                     
                     const percentChange = (deltaY / 0.3) * 100;
                     let newBr = this.baseBrightness + percentChange;
                     newBr = Math.max(0, Math.min(100, Math.round(newBr)));
                     
                     virtualLights.forEach(vl => {
                         if (vl.realDevice && vl.isOn && typeof vl.setBrightness === 'function') {
                             if (Math.abs(vl.brightness - newBr) > 5) {
                                 vl.setBrightness(newBr);
                             }
                         }
                     });
                 }
            } else if (!isFistCurled && !isThumbExtended) {
                 if (this.gestureState !== 'IDLE') {
                     console.log("✋ BRIGHTNESS CONTROL ENDED");
                 }
                 this.gestureState = 'IDLE';
            }
        }
    }
}
