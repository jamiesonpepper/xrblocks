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

export class OcclusionManager {
    constructor() {
        this.enabled = true;
        this.evaluatedIndex = 0;
        this.batchSize = 4; // Evaluate 4 cards per frame round-robin for 90fps smoothness
        this.summonedCard = null;
        this.summonLookAwayTime = 0;
        this.onSummonStateChanged = null;
    }

    /**
     * Determines whether a device domain or category is exempt from line-of-sight occlusion
     * (critical perimeter security fixtures: locks and garage doors/covers).
     */
    isSecurityPassThrough(device) {
        if (!device) return false;
        const domain = (device.realDevice?.domain || device.category || '').toLowerCase();
        const id = (device.realDevice?.id || '').toLowerCase();
        return domain === 'lock' || domain === 'cover' || domain === 'garage_door' ||
               id.startsWith('lock.') || id.startsWith('cover.') || domain.includes('garage');
    }

    /**
     * Staggered per-frame evaluation of occlusion and gaze dwell.
     * @param {THREE.Camera} camera 
     * @param {Array} cards - Array of VirtualLight3D instances
     * @param {THREE.Object3D|Array} occludingMesh - WebXR depth mesh, planes, or room meshes
     * @param {number} delta - Frame delta time in seconds
     */
    update(camera, cards = [], occludingMesh = null, delta = 0.016) {
        if (!this.enabled || !camera || !cards || cards.length === 0) return;

        camera.getWorldPosition(_scratchCamPos);
        camera.getWorldDirection(_scratchCamDir);

        // 1. Check gaze dwell on distant pass-through cards (Locks & Covers)
        this._updateGazeSummon(camera, cards, delta);

        // 2. Check summoned card look-away auto-dismissal
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

        // 3. Staggered line-of-sight occlusion evaluation
        const count = cards.length;
        const meshes = [];
        if (occludingMesh) {
            if (Array.isArray(occludingMesh)) meshes.push(...occludingMesh);
            else meshes.push(occludingMesh);
        }

        for (let i = 0; i < this.batchSize; i++) {
            const idx = (this.evaluatedIndex + i) % count;
            const card = cards[idx];
            if (!card || card.isSummonedToFoV) continue;

            this._evaluateCardOcclusion(camera, card, meshes);
        }

        this.evaluatedIndex = (this.evaluatedIndex + this.batchSize) % count;
    }

    /**
     * Evaluates line of sight between camera and card.
     */
    _evaluateCardOcclusion(camera, card, occludingMeshes) {
        const isSecurity = this.isSecurityPassThrough(card);
        card.isPassThrough = isSecurity;

        // If card has no panel or is currently being dragged, preserve visibility
        if (!card.panel) return;

        // Never occlude cards that are unpaired, in device selection, expanded by proximity/gaze, or summoned
        if (card.unpaired || !card.realDevice || card.isSelectingDevice || card.isProximityExpanded || card.isSummonedToFoV) {
            card.isOccluded = false;
            card.isPassThroughOccluded = false;
            if (!card.visible) this._fadeCard(card, true);
            return;
        }

        card.getWorldPosition(_scratchCardPos);
        const distToCard = _scratchCamPos.distanceTo(_scratchCardPos);

        // Skip LOS raycast if within near touch distance (< 2.0m) or no occluding meshes
        if (distToCard < 2.0 || occludingMeshes.length === 0) {
            card.isOccluded = false;
            card.isPassThroughOccluded = false;
            if (!card.visible) this._fadeCard(card, true);
            return;
        }

        _scratchDir.copy(_scratchCardPos).sub(_scratchCamPos).normalize();
        _raycaster.set(_scratchCamPos, _scratchDir);
        _raycaster.near = 0.1;
        _raycaster.far = distToCard;

        let hits = [];
        for (const mesh of occludingMeshes) {
            if (!mesh) continue;
            const wasVis = mesh.visible;
            mesh.visible = true; // Ensure raycaster tests geometry even when debug material is invisible
            const mHits = _raycaster.intersectObject(mesh, true);
            mesh.visible = wasVis;
            if (mHits && mHits.length > 0) {
                hits.push(...mHits);
            }
        }
        if (hits.length > 1) {
            hits.sort((a, b) => a.distance - b.distance);
        }
        // Wall blockage test: must be blocked significantly before the card (> 45cm in front) to avoid false positives with fixture depth meshes
        const isBlocked = hits.length > 0 && hits[0].distance < (distToCard - 0.45);

        if (isSecurity) {
            // SECURITY PASS-THROUGH: NEVER HIDE LOCKS OR COVERS!
            card.isOccluded = false;
            card.isPassThroughOccluded = isBlocked;
            if (!card.visible) this._fadeCard(card, true);
            this._applySecurityBeaconVisual(card, isBlocked);
        } else {
            // STANDARD DEVICE: Hide when occluded by walls
            card.isPassThroughOccluded = false;
            if (isBlocked) {
                if (!card.isOccluded) {
                    card.isOccluded = true;
                    this._fadeCard(card, false);
                }
            } else {
                if (card.isOccluded) {
                    card.isOccluded = false;
                    this._fadeCard(card, true);
                }
            }
        }
    }

    /**
     * Checks if the user is gazing at a distant security pass-through card for > 2 seconds.
     */
    _updateGazeSummon(camera, cards, delta) {
        let activeGazedCard = null;

        for (const card of cards) {
            if (!card || card.isSummonedToFoV || !card.visible) continue;
            if (!this.isSecurityPassThrough(card)) continue;

            card.getWorldPosition(_scratchCardPos);
            const dist = _scratchCamPos.distanceTo(_scratchCardPos);
            // Only summon if distant (> 1.2m away)
            if (dist < 1.2) {
                card._gazeDwellTime = 0;
                continue;
            }

            _scratchDir.copy(_scratchCardPos).sub(_scratchCamPos).normalize();
            const angleDeg = THREE.MathUtils.radToDeg(_scratchCamDir.angleTo(_scratchDir));

            // Dwell cone: within 7 degrees of gaze center
            if (angleDeg < 7.0 && !activeGazedCard) {
                activeGazedCard = card;
                card._gazeDwellTime = (card._gazeDwellTime || 0) + delta;

                // Visual progress feedback
                const progress = Math.min(1.0, card._gazeDwellTime / 2.0);
                this._updateDwellIndicator(card, progress);

                if (card._gazeDwellTime >= 2.0) {
                    card._gazeDwellTime = 0;
                    this._updateDwellIndicator(card, 0);
                    this.summonCardToFoV(card, camera);
                }
            } else {
                if (card._gazeDwellTime > 0) {
                    card._gazeDwellTime = Math.max(0, card._gazeDwellTime - delta * 2);
                    this._updateDwellIndicator(card, 0);
                }
            }
        }
    }

    /**
     * Summons a distant security card into active FoV.
     */
    summonCardToFoV(card, camera) {
        if (!card || card.isSummonedToFoV) return;

        // If another card was summoned, return it first
        if (this.summonedCard && this.summonedCard !== card) {
            this.returnSummonedCard(this.summonedCard);
        }

        // Store original anchor pose
        card._originalAnchorPos = card.position.clone();
        card._originalAnchorQuat = card.quaternion.clone();

        // 1. Dissolve fade out at physical anchor
        this._fadeCard(card, false, 200, () => {
            // 2. Position 1.1m in front of camera at chest/eye level
            camera.getWorldPosition(_scratchCamPos);
            camera.getWorldDirection(_scratchCamDir);

            const targetPos = _scratchCamPos.clone().add(_scratchCamDir.clone().multiplyScalar(1.1));
            targetPos.y = Math.max(1.1, _scratchCamPos.y - 0.08); // Comfortable chest height

            card.position.copy(targetPos);
            card.lookAt(_scratchCamPos);

            card.isSummonedToFoV = true;
            card.isCondensed = false;
            card.isProximityExpanded = true;
            this.summonedCard = card;
            this.summonLookAwayTime = 0;

            if (card.rebuildPanel) card.rebuildPanel();

            // 3. Dissolve fade back in at active FoV
            this._fadeCard(card, true, 200);

            if (this.onSummonStateChanged) this.onSummonStateChanged(card, true);
        });
    }

    /**
     * Returns a summoned security card back to its physical 3D anchor position.
     */
    returnSummonedCard(card) {
        if (!card || !card.isSummonedToFoV) return;

        this._fadeCard(card, false, 200, () => {
            if (card._originalAnchorPos) {
                card.position.copy(card._originalAnchorPos);
                card.quaternion.copy(card._originalAnchorQuat);
            }

            card.isSummonedToFoV = false;
            card.isProximityExpanded = false;
            card.isCondensed = true;
            if (this.summonedCard === card) this.summonedCard = null;
            this.summonLookAwayTime = 0;

            if (card.rebuildPanel) card.rebuildPanel();
            this._fadeCard(card, true, 200);

            if (this.onSummonStateChanged) this.onSummonStateChanged(card, false);
        });
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
        } else {
            // Standard clean white border when in direct sight
            if (card.panel.setStyle && !card.isSummonedToFoV) {
                card.panel.setStyle({
                    borderColor: '#FFFFFF',
                    borderWidth: 1.5
                });
            }
        }
    }

    /**
     * Shows visual progress indicator when gazing at a distant security card.
     */
    _updateDwellIndicator(card, progress) {
        if (!card._dwellIndicator && progress > 0) {
            // Create a small glowing ring sprite or badge
            const geom = new THREE.RingGeometry(0.18, 0.20, 32);
            const mat = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.85,
                depthTest: false
            });
            const ring = new THREE.Mesh(geom, mat);
            ring.position.set(0, 0, 0.02);
            card.add(ring);
            card._dwellIndicator = ring;
        }

        if (card._dwellIndicator) {
            if (progress <= 0) {
                card.remove(card._dwellIndicator);
                card._dwellIndicator = null;
            } else {
                card._dwellIndicator.scale.set(1 + progress * 0.2, 1 + progress * 0.2, 1);
                card._dwellIndicator.material.opacity = 0.4 + progress * 0.6;
            }
        }
    }
}
