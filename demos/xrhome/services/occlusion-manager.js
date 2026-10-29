/**
 * services/occlusion-manager.js
 * Handles selective line-of-sight occlusion with security pass-through exemptions
 * and glance-to-summon (dwell > 2.0s) active FoV recall for door locks and garage doors/covers.
 */

import * as THREE from 'three';

const _raycaster = new THREE.Raycaster();
const _scratchCamPos = new THREE.Vector3();
const _scratchCamDir = new THREE.Vector3();
const _scratchCardPos = new THREE.Vector3();
const _scratchDir = new THREE.Vector3();
const _scratchPointerRaycaster = new THREE.Raycaster();
const _scratchPointerMatrix = new THREE.Matrix4();

export class OcclusionManager {
    constructor() {
        this.enabled = true;
        this.evaluatedIndex = 0;
        this.batchSize = 4; // Evaluate 4 cards per frame round-robin for 90fps smoothness
        this.summonedCard = null;
        this.summonLookAwayTime = 0;
        this.onSummonStateChanged = null;
        this.blockAllCards = false; // When true, even security pass-through cards (locks, covers, cameras) will be hidden by physical obstacles
        this.isScanning = false; // When true, camera is actively scanning; occlusion is bypassed so all new cards on walls are 100% visible
    }

    /**
     * Helper to configure depth testing, polygon offsets, and draw order on a card's meshes.
     * When bypassDepth is true, the card completely ignores the hardware Z-buffer (so ceilings and walls never clip it).
     */
    setCardDepthOcclusion(card, bypassDepth) {
        if (!card) return;
        const targetRenderOrder = bypassDepth ? 999 : 0;
        card.renderOrder = targetRenderOrder;
        if (card.panel) card.panel.renderOrder = targetRenderOrder;

        card.traverse((child) => {
            if (child.isMesh) {
                child.renderOrder = targetRenderOrder;
            }
            if (child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                for (const mat of materials) {
                    if (!mat) continue;
                    const wantDepthTest = !bypassDepth;
                    if (mat.depthTest !== wantDepthTest || (bypassDepth && mat.depthWrite !== false)) {
                        mat.depthTest = wantDepthTest;
                        if (bypassDepth) {
                            if (mat._origDepthWrite === undefined) {
                                mat._origDepthWrite = mat.depthWrite;
                            }
                            mat.depthWrite = false;
                        } else {
                            if (mat._origDepthWrite !== undefined) {
                                mat.depthWrite = mat._origDepthWrite;
                            }
                        }
                        mat.needsUpdate = true;
                    }
                }
            }
        });
    }

    /**
     * Sets scanning mode. When scanning is active, pauses line-of-sight occlusion
     * and ensures all cards are fully visible for easy placement and setup.
     * When scanning stops, normal depth-mesh occlusion resumes.
     */
    setScanningMode(isScanning, cards = []) {
        this.isScanning = !!isScanning;
        if (cards && cards.length > 0) {
            for (const card of cards) {
                if (!card) continue;
                const isPaired = !!(card.realDevice || card.linkedNodeId || card.isLightingGroup);
                const isLocked = isPaired && (!card.isLightingGroup || card.isPositionLocked);
                const shouldBypass = this.isScanning || !isLocked || card.isSelectingDevice;

                if (shouldBypass) {
                    card.isOccluded = false;
                    card.isPassThroughOccluded = false;
                    card.visible = true;
                    if (card.panel) {
                        card.panel.visible = true;
                        card.panel.traverse(child => {
                            if (child.material) {
                                child.material.opacity = 1.0;
                            }
                        });
                    }
                    this.setCardDepthOcclusion(card, true);
                }
            }
        }
    }

    /**
     * Determines whether a device domain or category is exempt from line-of-sight occlusion
     * (critical perimeter and security fixtures: locks, covers/garage doors, and cameras).
     */
    isSecurityPassThrough(device) {
        if (!device) return false;

        // ONLY operate after a camera, lock, or cover is paired! Unpaired cards must remain in place for setup/pairing
        const isPaired = !!(device.realDevice || device.linkedNodeId);
        if (!isPaired) return false;

        const domain = (device.realDevice?.domain || device.category || device.geminiData?.category || '').toLowerCase();
        const id = (device.realDevice?.id || device.realDevice?.entity_id || device.linkedNodeId || '').toLowerCase();
        const cat = (device.category || device.geminiData?.category || '').toLowerCase();
        const label = (device.labelText || device.label || device.originalLabel || device.realDevice?.name || '').toLowerCase();
        const deviceClass = (device.realDevice?.attributes?.device_class || '').toLowerCase();

        // 1. Domain / Category exact checks
        if (domain === 'lock' || domain === 'cover' || domain === 'garage_door' || domain === 'camera' ||
            cat === 'lock' || cat === 'cover' || cat === 'garage_door' || cat === 'camera') {
            return true;
        }

        // 2. Entity ID prefix checks
        if (id.startsWith('lock.') || id.startsWith('cover.') || id.startsWith('camera.') || id.startsWith('doorbell.')) {
            return true;
        }

        // 3. Substring checks for domains, categories, labels, and device classes
        if (domain.includes('camera') || domain.includes('doorbell') || domain.includes('garage') || domain.includes('cover') || domain.includes('lock')) {
            return true;
        }
        if (cat.includes('camera') || cat.includes('doorbell') || cat.includes('garage') || cat.includes('cover') || cat.includes('lock')) {
            return true;
        }
        if (label.includes('camera') || label.includes('doorbell') || label.includes('cam') ||
            label.includes('garage') || label.includes('cover') || label.includes('lock')) {
            return true;
        }
        if (deviceClass.includes('garage') || deviceClass.includes('door') || deviceClass.includes('lock')) {
            return true;
        }

        // 4. Runtime feature indicators on VirtualLight3D
        if (device.isViewingCamera || device._cameraVideo || device._cameraCanvas) {
            return true;
        }

        return false;
    }

    /**
     * Per-frame evaluation of occlusion, gaze dwell, and depth testing.
     * Unpaired and unlocked cards bypass depth testing EVERY frame so they are never occluded.
     * Paired, locked cards are evaluated for line-of-sight occlusion.
     */
    update(camera, cards = [], occludingMesh = null, delta = 0.016, controllers = []) {
        if (!this.enabled || !camera || !cards || cards.length === 0) return;

        camera.getWorldPosition(_scratchCamPos);
        camera.getWorldDirection(_scratchCamDir);

        // 1. Every frame: separate cards into Unpaired/Unlocked (bypass depth test every frame) and Paired (evaluate occlusion)
        const pairedCardsToTest = [];

        for (const card of cards) {
            if (!card) continue;
            const isPaired = !!(card.realDevice || card.linkedNodeId || card.isLightingGroup);
            const isLocked = isPaired && (!card.isLightingGroup || card.isPositionLocked);
            const isBypassed = this.isScanning || !isLocked || card.isSelectingDevice || card.isSummonedToFoV || card.isDragging;

            if (isBypassed) {
                // UNPAIRED / UNLOCKED: NEVER occluded by depth mesh, ceilings, or walls
                card.isOccluded = false;
                card.isPassThroughOccluded = false;
                card.visible = true;
                if (card.panel) card.panel.visible = true;
                this.setCardDepthOcclusion(card, true);
            } else {
                pairedCardsToTest.push(card);
            }
        }

        // 2. Check gaze dwell on distant pass-through cards (Locks, Covers, Cameras)
        this._updateGazeSummon(camera, pairedCardsToTest, delta);

        // 3. Check controller pointer aim on distant pass-through cards (Locks, Covers, Cameras)
        this._updatePointerSummon(camera, pairedCardsToTest, controllers, delta);

        // 4. Check summoned card look-away auto-dismissal
        if (this.summonedCard) {
            this.summonedCard.getWorldPosition(_scratchCardPos);
            _scratchDir.copy(_scratchCardPos).sub(_scratchCamPos).normalize();
            const angleDeg = THREE.MathUtils.radToDeg(_scratchCamDir.angleTo(_scratchDir));
            if (angleDeg > 35) {
                this.summonLookAwayTime += delta;
                if (this.summonLookAwayTime >= 8.0) {
                    this.returnSummonedCard(this.summonedCard);
                }
            } else {
                this.summonLookAwayTime = 0;
            }
        }

        // 5. Staggered line-of-sight occlusion evaluation for PAIRED devices (bypassed during active scanning)
        if (!this.isScanning && pairedCardsToTest.length > 0) {
            const count = pairedCardsToTest.length;
            const meshes = [];
            if (occludingMesh) {
                if (Array.isArray(occludingMesh)) meshes.push(...occludingMesh);
                else meshes.push(occludingMesh);
            }
            for (const mesh of meshes) {
                if (mesh && mesh.geometry) {
                    mesh.geometry.computeBoundingSphere();
                }
            }

            const batch = Math.min(this.batchSize, count);
            for (let i = 0; i < batch; i++) {
                const idx = (this.evaluatedIndex + i) % count;
                const card = pairedCardsToTest[idx];
                if (!card || card.isSummonedToFoV) continue;

                this._evaluateCardOcclusion(camera, card, meshes);
            }

            this.evaluatedIndex = (this.evaluatedIndex + batch) % count;
        }
    }

    /**
     * Evaluates line of sight between camera and a paired, locked card.
     */
    _evaluateCardOcclusion(camera, card, occludingMeshes) {
        const isSecurity = this.isSecurityPassThrough(card);
        card.isPassThrough = isSecurity;

        // If card has no panel, skip
        if (!card.panel) return;

        card.getWorldPosition(_scratchCardPos);
        const distToCard = _scratchCamPos.distanceTo(_scratchCardPos);

        // Skip LOS raycast if within arm's reach (< 0.80m) or no occluding meshes
        if (distToCard < 0.80 || occludingMeshes.length === 0) {
            card.isOccluded = false;
            card.isPassThroughOccluded = false;
            card.visible = true;
            if (card.panel) card.panel.visible = true;
            this.setCardDepthOcclusion(card, false);
            return;
        }

        _scratchDir.copy(_scratchCardPos).sub(_scratchCamPos).normalize();
        _raycaster.set(_scratchCamPos, _scratchDir);
        _raycaster.near = 0.1;
        _raycaster.far = distToCard;

        let hits = [];
        for (const mesh of occludingMeshes) {
            if (!mesh) continue;
            mesh.updateMatrixWorld(true);
            const wasVis = mesh.visible;
            mesh.visible = true; // Ensure raycaster tests geometry even when debug material is invisible
            if (mesh.material) {
                mesh.material.side = THREE.DoubleSide;
            }
            if (mesh.geometry) {
                mesh.geometry.computeBoundingSphere();
            }
            const mHits = _raycaster.intersectObject(mesh, true);
            mesh.visible = wasVis;
            if (mHits && mHits.length > 0) {
                hits.push(...mHits);
            }
        }
        if (hits.length > 1) {
            hits.sort((a, b) => a.distance - b.distance);
        }
        // Obstacle blockage test: must be blocked significantly before card (> 15cm) to avoid self-intersection with mounting surface
        const isBlocked = hits.length > 0 && hits[0].distance < (distToCard - 0.15);

        if (isSecurity && !this.blockAllCards) {
            // SECURITY PASS-THROUGH: Keep locks, covers, and cameras visible as beacons through walls
            card.isOccluded = false;
            card.isPassThroughOccluded = isBlocked;
            card.visible = true;
            if (card.panel) card.panel.visible = true;
            this._applySecurityBeaconVisual(card, isBlocked);
        } else {
            // STANDARD DEVICE (or blockAllCards mode): Hardware Z-buffer handles physical occlusion
            card.isPassThroughOccluded = false;
            card.isOccluded = isBlocked;
            card.visible = true; // Kept in scene graph so WebGL Z-buffer physically clips pixels behind real objects
            if (card.panel) card.panel.visible = true;
            this.setCardDepthOcclusion(card, false);
        }
    }

    /**
     * Checks if the user is gazing at a distant security pass-through card (Lock, Cover, Camera).
     * When gazed at for ~0.35s, redraws the card closer in physical space without any pulsing circle.
     */
    _updateGazeSummon(camera, cards, delta) {
        let activeGazedCard = null;

        for (const card of cards) {
            if (!card || card.isSummonedToFoV || !card.visible) continue;
            if (!this.isSecurityPassThrough(card)) continue;

            // Block gaze dwell during post-return cooldown (1-2s)
            const now = performance.now();
            if (card._summonCooldownUntil && now < card._summonCooldownUntil) {
                card._gazeDwellTime = 0;
                continue;
            }

            // Clean up any old dwell indicator ring if present
            if (card._dwellIndicator) {
                card.remove(card._dwellIndicator);
                card._dwellIndicator.geometry?.dispose();
                card._dwellIndicator.material?.dispose();
                card._dwellIndicator = null;
            }

            card.getWorldPosition(_scratchCardPos);
            const dist = _scratchCamPos.distanceTo(_scratchCardPos);
            // If already at near touch distance (< 0.60m), no need to summon closer
            if (dist <= 0.60) {
                card._gazeDwellTime = 0;
                continue;
            }

            _scratchDir.copy(_scratchCardPos).sub(_scratchCamPos).normalize();
            const angleDeg = THREE.MathUtils.radToDeg(_scratchCamDir.angleTo(_scratchDir));

            // Central gaze cone (within 10 degrees)
            if (angleDeg < 10.0 && !activeGazedCard) {
                activeGazedCard = card;
                card._gazeDwellTime = (card._gazeDwellTime || 0) + delta;

                // Redraw closer to user position after ~0.35s sustained gaze (no pulsing circle)
                if (card._gazeDwellTime >= 0.35) {
                    card._gazeDwellTime = 0;
                    this.summonCardToFoV(card, camera);
                }
            } else {
                if (card._gazeDwellTime > 0) {
                    card._gazeDwellTime = Math.max(0, card._gazeDwellTime - delta * 2);
                }
            }
        }
    }

    /**
     * Checks if a controller pointer or mouse ray is aimed at a distant security pass-through card (Lock, Cover, Camera).
     * When pointed at for ~0.25s, redraws the card closer in physical space without any pulsing circle.
     */
    _updatePointerSummon(camera, cards, controllers, delta) {
        for (const card of cards) {
            if (!card || card.isSummonedToFoV || !card.visible || !card.panel) continue;
            if (!this.isSecurityPassThrough(card)) continue;

            // Block pointer dwell during post-return cooldown (1-2s)
            const now = performance.now();
            if (card._summonCooldownUntil && now < card._summonCooldownUntil) {
                card._pointerDwellTime = 0;
                continue;
            }

            card.getWorldPosition(_scratchCardPos);
            const dist = _scratchCamPos.distanceTo(_scratchCardPos);
            // If already at near touch distance (< 0.60m), no need to summon closer
            if (dist <= 0.60) {
                card._pointerDwellTime = 0;
                continue;
            }

            let isPointedAt = false;

            // 1. Check WebXR controllers
            if (controllers && controllers.length > 0) {
                for (const ctrl of controllers) {
                    if (!ctrl) continue;
                    _scratchPointerRaycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
                    _scratchPointerMatrix.identity().extractRotation(ctrl.matrixWorld);
                    _scratchPointerRaycaster.ray.direction.set(0, 0, -1).applyMatrix4(_scratchPointerMatrix);
                    _scratchPointerRaycaster.near = 0.05;
                    _scratchPointerRaycaster.far = 15.0;

                    const hits = _scratchPointerRaycaster.intersectObject(card.panel, true);
                    if (hits && hits.length > 0) {
                        isPointedAt = true;
                        break;
                    }
                }
            }

            // 2. Check desktop / mouse user pointing
            if (!isPointedAt && typeof xb !== 'undefined' && xb.user && typeof xb.user.isPointingAt === 'function') {
                try {
                    if (xb.user.isPointingAt(card) || xb.user.isPointingAt(card.panel)) {
                        isPointedAt = true;
                    }
                } catch (_) {}
            }

            if (isPointedAt) {
                card._pointerDwellTime = (card._pointerDwellTime || 0) + delta;
                if (card._pointerDwellTime >= 0.25) { // 250ms intentional aim
                    card._pointerDwellTime = 0;
                    this.summonCardToFoV(card, camera);
                }
            } else {
                if (card._pointerDwellTime > 0) {
                    card._pointerDwellTime = Math.max(0, card._pointerDwellTime - delta * 2);
                }
            }
        }
    }

    /**
     * Summons a distant security card (Lock, Cover, Camera) into active FoV directly in front of the user (0.65m chest height).
     */
    summonCardToFoV(card, camera) {
        if (!card || card.isSummonedToFoV || !this.isSecurityPassThrough(card)) return;

        // Block summon if within cooldown period after Return to Anchor (1-2 seconds)
        const now = performance.now();
        if (card._summonCooldownUntil && now < card._summonCooldownUntil) {
            return;
        }

        // If another card was summoned, return it first
        if (this.summonedCard && this.summonedCard !== card) {
            this.returnSummonedCard(this.summonedCard);
        }

        // Clean up any lingering ring or indicator
        if (card._dwellIndicator) {
            card.remove(card._dwellIndicator);
            card._dwellIndicator.geometry?.dispose();
            card._dwellIndicator.material?.dispose();
            card._dwellIndicator = null;
        }

        // Store original anchor pose if not already saved
        if (!card._originalAnchorPos) {
            card._originalAnchorPos = card.position.clone();
            card._originalAnchorQuat = card.quaternion.clone();
        }

        // Ensure active camera pose
        if (camera && camera.getWorldPosition) {
            camera.getWorldPosition(_scratchCamPos);
            camera.getWorldDirection(_scratchCamDir);
        }

        // Position 0.65m directly in front of camera at comfortable physical chest level
        const targetPos = _scratchCamPos.clone().add(_scratchCamDir.clone().multiplyScalar(0.65));
        targetPos.y = Math.max(0.85, _scratchCamPos.y - 0.12); // Natural chest level

        card.position.copy(targetPos);
        card.lookAt(_scratchCamPos);
        card.updateMatrixWorld(true);

        card.isSummonedToFoV = true;
        card.isCondensed = false;
        card.isProximityExpanded = true;
        this.summonedCard = card;
        this.summonLookAwayTime = 0;

        if (card.rebuildPanel) card.rebuildPanel();

        // Smooth subtle entrance fade
        this._fadeCard(card, true, 120);

        if (this.onSummonStateChanged) this.onSummonStateChanged(card, true);
    }

    /**
     * Returns a summoned security card back to its physical 3D anchor position.
     */
    returnSummonedCard(card) {
        if (!card || !card.isSummonedToFoV) return;

        // Enact a 2-second cooldown so gaze or pointer doesn't re-trigger summon immediately
        card._summonCooldownUntil = performance.now() + 2000;
        card._gazeDwellTime = 0;
        card._pointerDwellTime = 0;
        card._gazeFocusStartTime = null;
        card._lastGazeLostTime = null;

        if (card._originalAnchorPos) {
            card.position.copy(card._originalAnchorPos);
            card.quaternion.copy(card._originalAnchorQuat);
            card.updateMatrixWorld(true);
        }

        card.isSummonedToFoV = false;
        card.isProximityExpanded = false;
        card.isCondensed = true;
        if (this.summonedCard === card) this.summonedCard = null;
        this.summonLookAwayTime = 0;

        if (card.rebuildPanel) card.rebuildPanel();
        this._fadeCard(card, true, 120);

        if (this.onSummonStateChanged) this.onSummonStateChanged(card, false);
    }

    /**
     * Smoothly fades a card in or out using panel material opacity.
     */
    _fadeCard(card, show, duration = 150, onComplete = null) {
        card.visible = true;
        const targetOpacity = show ? 1.0 : 0.0;
        const startTime = performance.now();

        const step = (now) => {
            const elapsed = now - startTime;
            const progress = Math.min(1.0, elapsed / duration);
            
            // Adjust opacity across panel meshes
            if (card.panel) {
                card.panel.traverse(child => {
                    if (child.material) {
                        child.material.transparent = true;
                        child.material.opacity = show ? progress : (1.0 - progress);
                    }
                });
            }

            if (progress < 1.0) {
                requestAnimationFrame(step);
            } else {
                card.visible = show;
                if (card.panel) {
                    card.panel.visible = show;
                }
                if (onComplete) onComplete();
            }
        };

        requestAnimationFrame(step);
    }

    /**
     * Updates security beacon outline glow on occluded pass-through cards.
     */
    _applySecurityBeaconVisual(card, isPassThroughOccluded) {
        if (!card.panel) return;
        if (isPassThroughOccluded) {
            // Illuminated white glow for see-through pass-through state
            if (card.panel.setStyle) {
                card.panel.setStyle({
                    borderColor: '#FFFFFF',
                    borderWidth: 2.5
                });
            }
            // Allow security beacons to shine through physical walls in the Z-buffer
            this.setCardDepthOcclusion(card, true);
        } else {
            // Standard clean white border when in direct sight
            if (card.panel.setStyle && !card.isSummonedToFoV) {
                card.panel.setStyle({
                    borderColor: '#FFFFFF',
                    borderWidth: 1.5
                });
            }
            // Normal depth testing when in direct line of sight
            this.setCardDepthOcclusion(card, false);
        }
    }
}

