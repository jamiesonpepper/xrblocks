/**
 * components/auxiliary-room-menu.js
 * Unified Auxiliary Room/Area Device Selector & Control Menu in XR.
 * Provides hierarchical area browsing, batch room controls ("All Off"), inline device toggles,
 * and a 3D tracer beacon to locate physical devices anchored in the room.
 */

import * as THREE from 'three';
import * as xb from 'xrblocks';

export class AuxiliaryRoomMenu {
    constructor({ scene, smartHome, virtualLights = [], onLocate = null }) {
        this.scene = scene;
        this.smartHome = smartHome;
        this.virtualLights = virtualLights;
        this.onLocate = onLocate;

        this.panel = null;
        this.isOpen = false;
        this.selectedArea = 'All';
        this.expandedAreas = new Set();
        this.tracerLine = null;
        this.tracerTimeout = null;
    }

    /**
     * Toggles open / closed state.
     */
    toggle(camera) {
        if (this.isOpen) {
            this.close();
        } else {
            this.open(camera);
        }
    }

    open(camera) {
        this.isOpen = true;
        this.render(camera);
    }

    close() {
        this.isOpen = false;
        if (this.panel && this.scene) {
            this.scene.remove(this.panel);
            this.panel = null;
        }
        this.clearTracer();
    }

    /**
     * Clears any active 3D tracer beacon line.
     */
    clearTracer() {
        if (this.tracerLine && this.scene) {
            this.scene.remove(this.tracerLine);
            this.tracerLine = null;
        }
        if (this.tracerTimeout) {
            clearTimeout(this.tracerTimeout);
            this.tracerTimeout = null;
        }
    }

    /**
     * Emits a glowing 3D tracer line connecting the auxiliary menu to the physical card.
     */
    emitTracer(targetCard) {
        this.clearTracer();
        if (!targetCard || !this.panel || !this.scene) return;

        const startPos = new THREE.Vector3();
        const endPos = new THREE.Vector3();
        this.panel.getWorldPosition(startPos);
        targetCard.getWorldPosition(endPos);

        const points = [startPos, endPos];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
            color: 0xFFFFFF,
            linewidth: 3,
            transparent: true,
            opacity: 0.9,
            depthTest: false
        });

        this.tracerLine = new THREE.Line(geometry, material);
        this.scene.add(this.tracerLine);

        // Temporarily highlight target card
        if (targetCard.panel && targetCard.panel.setStyle) {
            targetCard.panel.setStyle({
                borderColor: '#FFFFFF',
                borderWidth: 3
            });
        }
        targetCard.visible = true; // Ensure visible through walls for locate duration

        this.tracerTimeout = setTimeout(() => {
            this.clearTracer();
            if (targetCard.panel && targetCard.panel.setStyle) {
                targetCard.panel.setStyle({
                    borderColor: '#FFFFFF',
                    borderWidth: 1.5
                });
            }
        }, 3500);
    }

    render(camera) {
        let previousPos = null;
        let previousQuat = null;
        if (this.panel) {
            previousPos = this.panel.position.clone();
            previousQuat = this.panel.quaternion.clone();
            if (this.scene) {
                this.scene.remove(this.panel);
            }
            this.panel = null;
        }

        if (camera) {
            this.lastCamera = camera;
        }
        const activeCamera = camera || this.lastCamera;

        const devices = Array.from((this.smartHome && this.smartHome.devices) ? this.smartHome.devices.values() : []);
        // Group by Area
        const areaGroups = {};
        devices.forEach(d => {
            // Filter helper entities and compound appliance child sensors
            if (d.id.startsWith('button.') || d.id.startsWith('select.') || d.id.startsWith('binary_sensor.')) return;
            const area = d.area || 'Other';
            if (!areaGroups[area]) areaGroups[area] = [];
            areaGroups[area].push(d);
        });

        const sortedAreas = Object.keys(areaGroups).sort((a, b) => a.localeCompare(b));

        // Header Row: Title + Close Button
        const titleText = new xb.UIText({
            text: "🏠 Room & Device Navigator",
            style: { fontSize: 17, fontWeight: 'bold', color: '#FFFFFF', flexGrow: 1 }
        });

        const closeBtn = new xb.UIButton({
            label: "✕",
            ariaLabel: "Close Room Menu",
            style: {
                width: 32,
                height: 32,
                borderRadius: 8,
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                borderWidth: 1,
                borderColor: '#FFFFFF',
                color: '#FFFFFF',
                ':hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.75)',
                    color: '#000000',
                    borderColor: '#FFFFFF',
                },
            },
            onClick: () => this.close()
        });

        const headerRow = new xb.UIPanel({
            style: {
                width: '100%',
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: 6
            },
            children: [titleText, closeBtn]
        });

        const contentChildren = [headerRow];

        // Area Sections
        sortedAreas.forEach(areaName => {
            const areaDevs = areaGroups[areaName];
            const onDevs = areaDevs.filter(d => d.isOn || d.state === 'on');
            const isExpanded = this.expandedAreas.has(areaName);

            // Area Header
            const areaLabel = new xb.UIText({
                text: `${areaName} (${onDevs.length}/${areaDevs.length} Active)`,
                style: { fontSize: 14, fontWeight: 'bold', color: '#FFFFFF', flexGrow: 1 }
            });

            // "All Off" / "All On" toggle button for area
            const isAnyActive = onDevs.length > 0;
            const allOffBtn = new xb.UIButton({
                label: isAnyActive ? "All Off" : "All On",
                ariaLabel: isAnyActive ? `All Off for ${areaName}` : `All On for ${areaName}`,
                style: {
                    width: 72,
                    height: 28,
                    borderRadius: 6,
                    backgroundColor: isAnyActive ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.28)',
                    borderColor: '#FFFFFF',
                    borderWidth: 1,
                    color: '#FFFFFF',
                    fontSize: 11,
                    fontWeight: 'bold',
                    ':hover': {
                        backgroundColor: 'rgba(255, 255, 255, 0.75)',
                        color: '#000000',
                        borderColor: '#FFFFFF',
                    },
                },
                onClick: async () => {
                    const targetState = !isAnyActive;
                    const promises = [];
                    for (const dev of areaDevs) {
                        const domain = dev.domain || dev.id.split('.')[0];
                        dev.isOn = targetState;
                        dev.state = targetState ? 'on' : 'off';

                        // Sync in-scene VirtualLight3D instances immediately
                        if (this.virtualLights && this.virtualLights.length > 0) {
                            const vl = this.virtualLights.find(v => v.realDevice?.id === dev.id);
                            if (vl) {
                                vl.isOn = targetState;
                                if (vl.realDevice) {
                                    vl.realDevice.isOn = targetState;
                                    vl.realDevice.state = dev.state;
                                }
                                if (typeof vl.updateVisuals === 'function') {
                                    vl.updateVisuals();
                                }
                            }
                        }

                        if (this.smartHome) {
                            if (domain === 'light') {
                                if (typeof this.smartHome.toggleLight === 'function') {
                                    promises.push(this.smartHome.toggleLight(dev.id, targetState));
                                } else if (typeof this.smartHome.controlDevice === 'function') {
                                    promises.push(this.smartHome.controlDevice(dev.id, targetState ? 'turn_on' : 'turn_off', {}, 'light'));
                                }
                            } else if (domain === 'switch') {
                                if (typeof this.smartHome.toggleSwitch === 'function') {
                                    promises.push(this.smartHome.toggleSwitch(dev.id, targetState));
                                } else if (typeof this.smartHome.controlDevice === 'function') {
                                    promises.push(this.smartHome.controlDevice(dev.id, targetState ? 'turn_on' : 'turn_off', {}, 'switch'));
                                }
                            } else if (domain === 'lock') {
                                if (typeof this.smartHome.controlLock === 'function') {
                                    promises.push(this.smartHome.controlLock(dev.id, targetState ? 'lock' : 'unlock'));
                                }
                            } else if (typeof this.smartHome.controlDevice === 'function') {
                                promises.push(this.smartHome.controlDevice(dev.id, targetState ? 'turn_on' : 'turn_off', {}, domain));
                            }
                        }
                    }

                    // Immediately re-render so "All Off" switches to "All On" (and vice versa) with zero lag
                    this.render();

                    // Concurrently dispatch Home Assistant API calls in background
                    try {
                        await Promise.allSettled(promises);
                    } catch (e) {
                        console.warn(`[AuxiliaryRoomMenu] Error toggling area devices:`, e);
                    }
                }
            });

            const toggleExpandBtn = new xb.UIButton({
                label: isExpanded ? "▲" : "▼",
                ariaLabel: isExpanded ? `Collapse ${areaName}` : `Expand ${areaName}`,
                style: {
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    backgroundColor: 'rgba(255, 255, 255, 0.15)',
                    borderWidth: 1,
                    borderColor: '#FFFFFF',
                    color: '#FFFFFF',
                    ':hover': {
                        backgroundColor: 'rgba(255, 255, 255, 0.75)',
                        color: '#000000',
                        borderColor: '#FFFFFF',
                    },
                },
                onClick: () => {
                    if (isExpanded) this.expandedAreas.delete(areaName);
                    else this.expandedAreas.add(areaName);
                    this.render();
                }
            });

            const areaHeaderRow = new xb.UIPanel({
                style: {
                    width: '100%',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    padding: 8,
                    backgroundColor: 'rgba(255, 255, 255, 0.10)',
                    borderWidth: 1,
                    borderColor: 'rgba(255, 255, 255, 0.35)',
                    borderRadius: 10
                },
                children: [areaLabel, allOffBtn, toggleExpandBtn]
            });

            contentChildren.push(areaHeaderRow);

            // Device Rows if expanded
            if (isExpanded) {
                areaDevs.forEach(dev => {
                    const devName = dev.name || dev.id;
                    const domain = dev.domain || dev.id.split('.')[0];
                    const isOn = !!(dev.isOn || dev.state === 'on');

                    const devText = new xb.UIText({
                        text: `${isOn ? '💡' : '⚪'} ${devName}`,
                        style: { fontSize: 13, color: '#FFFFFF', flexGrow: 1 }
                    });

                    // Inline Toggle Button
                    const pwrBtn = new xb.UIButton({
                        label: isOn ? "ON" : "OFF",
                        ariaLabel: `Toggle ${devName}`,
                        style: {
                            width: 52,
                            height: 26,
                            borderRadius: 6,
                            backgroundColor: isOn ? 'rgba(255, 255, 255, 0.32)' : 'rgba(255, 255, 255, 0.12)',
                            borderWidth: 1,
                            borderColor: isOn ? '#FFFFFF' : 'rgba(255, 255, 255, 0.5)',
                            color: '#FFFFFF',
                            fontSize: 11,
                            ':hover': {
                                backgroundColor: 'rgba(255, 255, 255, 0.75)',
                                color: '#000000',
                                borderColor: '#FFFFFF',
                            },
                        },
                        onClick: async () => {
                            const nextOn = !isOn;
                            dev.isOn = nextOn;
                            dev.state = nextOn ? 'on' : 'off';

                            // Sync in-scene VirtualLight3D instances immediately
                            if (this.virtualLights && this.virtualLights.length > 0) {
                                const vl = this.virtualLights.find(v => v.realDevice?.id === dev.id);
                                if (vl) {
                                    vl.isOn = nextOn;
                                    if (vl.realDevice) {
                                        vl.realDevice.isOn = nextOn;
                                        vl.realDevice.state = dev.state;
                                    }
                                    if (typeof vl.updateVisuals === 'function') {
                                        vl.updateVisuals();
                                    }
                                }
                            }

                            this.render();

                            try {
                                if (domain === 'light') {
                                    if (typeof this.smartHome.toggleLight === 'function') {
                                        await this.smartHome.toggleLight(dev.id, nextOn);
                                    } else if (typeof this.smartHome.controlDevice === 'function') {
                                        await this.smartHome.controlDevice(dev.id, nextOn ? 'turn_on' : 'turn_off', {}, 'light');
                                    }
                                } else if (domain === 'switch') {
                                    if (typeof this.smartHome.toggleSwitch === 'function') {
                                        await this.smartHome.toggleSwitch(dev.id, nextOn);
                                    } else if (typeof this.smartHome.controlDevice === 'function') {
                                        await this.smartHome.controlDevice(dev.id, nextOn ? 'turn_on' : 'turn_off', {}, 'switch');
                                    }
                                } else if (domain === 'lock') {
                                    if (typeof this.smartHome.controlLock === 'function') {
                                        await this.smartHome.controlLock(dev.id, nextOn ? 'lock' : 'unlock');
                                    }
                                } else if (domain === 'cover') {
                                    if (typeof this.smartHome.toggleCover === 'function') {
                                        await this.smartHome.toggleCover(dev.id);
                                    }
                                } else if (typeof this.smartHome.controlDevice === 'function') {
                                    await this.smartHome.controlDevice(dev.id, nextOn ? 'turn_on' : 'turn_off', {}, domain);
                                }
                            } catch (e) {
                                console.warn(`[AuxiliaryRoomMenu] Error toggling device ${dev.id}:`, e);
                            }
                        }
                    });

                    // "Locate in XR" Tracer Button
                    const locateBtn = new xb.UIButton({
                        label: "📍",
                        ariaLabel: `Locate ${devName}`,
                        style: {
                            width: 30,
                            height: 26,
                            borderRadius: 6,
                            backgroundColor: 'rgba(255, 255, 255, 0.16)',
                            borderColor: '#FFFFFF',
                            borderWidth: 1,
                            color: '#FFFFFF',
                            ':hover': {
                                backgroundColor: 'rgba(255, 255, 255, 0.75)',
                                color: '#000000',
                                borderColor: '#FFFFFF',
                            },
                        },
                        onClick: () => {
                            const targetVL = this.virtualLights.find(vl => vl.realDevice?.id === dev.id);
                            if (targetVL) {
                                this.emitTracer(targetVL);
                            }
                            if (this.onLocate) this.onLocate(dev, targetVL);
                        }
                    });

                    const devRow = new xb.UIPanel({
                        style: {
                            width: '100%',
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6,
                            paddingLeft: 12,
                            paddingRight: 6,
                            paddingTop: 4,
                            paddingBottom: 4
                        },
                        children: [devText, pwrBtn, locateBtn]
                    });

                    contentChildren.push(devRow);
                });
            }
        });

        this.panel = new xb.UICard({
            size: { width: 0.50, height: 'auto' },
            manipulation: true,
            style: {
                flexDirection: 'column',
                gap: 12,
                padding: 16,
                backgroundColor: 'rgba(0, 0, 0, 0.20)',
                borderWidth: 1.5,
                borderColor: '#FFFFFF',
                borderRadius: 20
            },
            children: contentChildren
        });

        // Position menu in front of camera or preserve live transform
        if (previousPos && previousQuat) {
            this.panel.position.copy(previousPos);
            this.panel.quaternion.copy(previousQuat);
        } else if (activeCamera) {
            const camPos = new THREE.Vector3();
            const camDir = new THREE.Vector3();
            activeCamera.getWorldPosition(camPos);
            activeCamera.getWorldDirection(camDir);

            const menuPos = camPos.clone().add(camDir.multiplyScalar(0.95));
            menuPos.y = Math.max(1.15, camPos.y - 0.05);

            this.panel.position.copy(menuPos);
            this.panel.lookAt(camPos);
        }

        if (this.scene) {
            this.scene.add(this.panel);
        }
        this.enforceDepth();
    }

    enforceDepth() {
        if (!this.panel) return;
        this.panel.renderOrder = 9999;
        this.panel.traverse((child) => {
            if (child.isMesh) {
                child.renderOrder = 9999;
            }
            if (child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                for (const mat of materials) {
                    if (!mat) continue;
                    if (mat.depthTest !== false || mat.depthWrite !== false) {
                        mat.depthTest = false;
                        mat.depthWrite = false;
                        mat.needsUpdate = true;
                    }
                }
            }
        });
    }
}
