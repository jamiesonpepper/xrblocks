/**
 * services/group-manager.js
 * Manages heterogeneous common lighting groups (smart bulbs + smart switches/plugs).
 * Handles synchronized power toggles, selective capability routing (brightness/color to bulbs only),
 * centroid spatial placement, and persistence.
 */

import * as THREE from 'three';

export class GroupManager {
    constructor() {
        this.groups = new Map(); // groupId -> GroupData
        this.onGroupChanged = null; // Callback when group state updates
    }

    /**
     * Create a new lighting group from member entity IDs.
     */
    createGroup({ id, name, area = 'Other', memberIds = [], position = null, quaternion = null, isPositionLocked = false }) {
        const groupId = id || `group_light_${Date.now()}`;
        const groupData = {
            id: groupId,
            name: name || `Lighting Group (${memberIds.length})`,
            area: area,
            type: 'lighting_group',
            memberIds: [...new Set(memberIds)],
            isOn: false,
            brightness: 100,
            colorTemp: 2700,
            currentHue: 0,
            stateColor: '#FFFFFF',
            isPositionLocked: !!isPositionLocked,
            position: position ? { x: position.x, y: position.y, z: position.z } : { x: 0, y: 1.5, z: -1.5 },
            quaternion: quaternion ? { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w } : { x: 0, y: 0, z: 0, w: 1 },
            updatedAt: Date.now()
        };

        this.groups.set(groupId, groupData);
        if (this.onGroupChanged) this.onGroupChanged(groupData);
        return groupData;
    }

    getGroup(groupId) {
        return this.groups.get(groupId);
    }

    getAllGroups() {
        return Array.from(this.groups.values());
    }

    isEntityInGroup(entityId) {
        for (const grp of this.groups.values()) {
            if (grp.memberIds.includes(entityId)) return grp;
        }
        return null;
    }

    /**
     * Calculate centroid 3D position from an array of member spatial objects.
     */
    calculateCentroid(spatialObjects = []) {
        if (!spatialObjects || spatialObjects.length === 0) {
            return new THREE.Vector3(0, 1.5, -1.5);
        }
        const centroid = new THREE.Vector3(0, 0, 0);
        spatialObjects.forEach(obj => {
            if (obj.position) centroid.add(obj.position);
        });
        centroid.divideScalar(spatialObjects.length);
        // Slightly offset height for clear group badge visibility
        centroid.y += 0.15;
        return centroid;
    }

    /**
     * Recalculate aggregate group state from live device map.
     */
    refreshGroupState(groupId, devicesMap) {
        const group = this.groups.get(groupId);
        if (!group) return null;

        let anyOn = false;
        let allOn = true;
        let onCount = 0;
        let totalBrightness = 0;
        let dimmableCount = 0;

        for (const memberId of group.memberIds) {
            const dev = devicesMap.get(memberId);
            if (!dev) continue;

            const isDevOn = !!(dev.isOn || dev.state === 'on');
            if (isDevOn) {
                anyOn = true;
                onCount++;
            } else {
                allOn = false;
            }

            if (dev.domain === 'light' && dev.attributes && dev.attributes.brightness !== undefined) {
                const bVal = Math.round((dev.attributes.brightness / 255) * 100);
                totalBrightness += bVal;
                dimmableCount++;
            }
        }

        group.isOn = anyOn;
        group.onCount = onCount;
        group.totalCount = group.memberIds.length;
        if (dimmableCount > 0) {
            group.brightness = Math.round(totalBrightness / dimmableCount);
        }

        return group;
    }

    /**
     * Toggles master power across all group members.
     * Bulbs receive light.turn_on/off; switches receive switch.turn_on/off.
     */
    async toggleGroupPower(groupId, targetOn, smartHome) {
        const group = this.groups.get(groupId);
        if (!group || !smartHome) return false;

        group.isOn = targetOn;
        const promises = [];

        for (const memberId of group.memberIds) {
            const dev = smartHome.devices ? smartHome.devices.get(memberId) : null;
            const domain = dev?.domain || (memberId.startsWith('switch.') ? 'switch' : 'light');

            if (domain === 'switch') {
                if (typeof smartHome.toggleSwitch === 'function') {
                    promises.push(smartHome.toggleSwitch(memberId, targetOn));
                } else if (typeof smartHome.controlDevice === 'function') {
                    promises.push(smartHome.controlDevice(memberId, targetOn ? 'turn_on' : 'turn_off', {}, 'switch'));
                }
            } else {
                if (typeof smartHome.toggleLight === 'function') {
                    promises.push(smartHome.toggleLight(memberId, targetOn));
                } else if (typeof smartHome.controlDevice === 'function') {
                    promises.push(smartHome.controlDevice(memberId, targetOn ? 'turn_on' : 'turn_off', {}, 'light'));
                }
            }
        }

        try {
            await Promise.all(promises);
            if (this.onGroupChanged) this.onGroupChanged(group);
            return true;
        } catch (e) {
            console.warn(`[GroupManager] Error toggling power for group ${groupId}:`, e);
            return false;
        }
    }

    /**
     * Sets brightness across all dimmable member bulbs in the group.
     * Wall switches are preserved without throwing errors.
     */
    async setGroupBrightness(groupId, brightnessPercent, smartHome) {
        const group = this.groups.get(groupId);
        if (!group || !smartHome) return false;

        group.brightness = Math.round(brightnessPercent);
        group.isOn = brightnessPercent > 0;
        const promises = [];

        for (const memberId of group.memberIds) {
            const dev = smartHome.devices ? smartHome.devices.get(memberId) : null;
            const domain = dev?.domain || (memberId.startsWith('switch.') ? 'switch' : 'light');

            if (domain === 'light') {
                if (typeof smartHome.setBrightness === 'function') {
                    promises.push(smartHome.setBrightness(memberId, brightnessPercent));
                } else if (typeof smartHome.setLightBrightness === 'function') {
                    promises.push(smartHome.setLightBrightness(memberId, brightnessPercent));
                } else if (typeof smartHome.controlDevice === 'function') {
                    const haBrightness = Math.round((brightnessPercent / 100) * 255);
                    promises.push(smartHome.controlDevice(memberId, 'turn_on', { brightness: haBrightness }));
                }
            } else if (domain === 'switch' && brightnessPercent > 0) {
                // Keep switch powered on if brightness > 0
                if (!dev?.isOn) {
                    if (typeof smartHome.toggleSwitch === 'function') {
                        promises.push(smartHome.toggleSwitch(memberId, true));
                    }
                }
            }
        }

        try {
            await Promise.all(promises);
            if (this.onGroupChanged) this.onGroupChanged(group);
            return true;
        } catch (e) {
            console.warn(`[GroupManager] Error setting brightness for group ${groupId}:`, e);
            return false;
        }
    }

    /**
     * Sets RGB color across all color-capable member bulbs.
     */
    async setGroupColor(groupId, r, g, b, smartHome) {
        const group = this.groups.get(groupId);
        if (!group || !smartHome) return false;

        const toHex = (n) => Math.round(n).toString(16).padStart(2, '0');
        group.stateColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
        const promises = [];

        for (const memberId of group.memberIds) {
            const dev = smartHome.devices ? smartHome.devices.get(memberId) : null;
            if (dev?.domain === 'light' || memberId.startsWith('light.')) {
                if (typeof smartHome.setColor === 'function') {
                    promises.push(smartHome.setColor(memberId, r, g, b));
                } else if (typeof smartHome.setLightColor === 'function') {
                    promises.push(smartHome.setLightColor(memberId, r, g, b));
                } else if (typeof smartHome.controlDevice === 'function') {
                    promises.push(smartHome.controlDevice(memberId, 'turn_on', { rgb_color: [r, g, b] }));
                }
            }
        }

        try {
            await Promise.all(promises);
            if (this.onGroupChanged) this.onGroupChanged(group);
            return true;
        } catch (e) {
            console.warn(`[GroupManager] Error setting color for group ${groupId}:`, e);
            return false;
        }
    }

    /**
     * Sets white color temperature (Kelvin) across all color temp capable bulbs.
     */
    async setGroupColorTemp(groupId, kelvin, hexColor, smartHome) {
        const group = this.groups.get(groupId);
        if (!group || !smartHome) return false;

        group.colorTemp = kelvin;
        if (hexColor) group.stateColor = hexColor;
        const promises = [];

        for (const memberId of group.memberIds) {
            const dev = smartHome.devices ? smartHome.devices.get(memberId) : null;
            if (dev?.domain === 'light' || memberId.startsWith('light.')) {
                if (typeof smartHome.setColorTemp === 'function') {
                    promises.push(smartHome.setColorTemp(memberId, kelvin));
                } else if (typeof smartHome.setLightColorTemp === 'function') {
                    promises.push(smartHome.setLightColorTemp(memberId, kelvin));
                } else if (typeof smartHome.controlDevice === 'function') {
                    promises.push(smartHome.controlDevice(memberId, 'turn_on', { color_temp_kelvin: kelvin }));
                }
            }
        }

        try {
            await Promise.all(promises);
            if (this.onGroupChanged) this.onGroupChanged(group);
            return true;
        } catch (e) {
            console.warn(`[GroupManager] Error setting color temp for group ${groupId}:`, e);
            return false;
        }
    }

    /**
     * Remove a member entity from the group.
     */
    removeMember(groupId, entityId) {
        const group = this.groups.get(groupId);
        if (!group) return false;

        group.memberIds = group.memberIds.filter(id => id !== entityId);
        if (group.memberIds.length === 0) {
            this.groups.delete(groupId);
        }
        if (this.onGroupChanged) this.onGroupChanged(group);
        return true;
    }

    /**
     * Delete a lighting group and optionally remove its anchor from Firestore.
     */
    deleteGroup(groupId, smartHome = null) {
        const deleted = this.groups.delete(groupId);
        if (smartHome && smartHome.deleteDeviceAnchor) {
            smartHome.deleteDeviceAnchor(groupId).catch(e => console.warn(`[GroupManager] Error deleting anchor ${groupId}:`, e));
        }
        if (this.onGroupChanged) this.onGroupChanged({ id: groupId, deleted: true });
        return deleted;
    }

    /**
     * Persist all groups to Firestore via saveDeviceAnchor.
     */
    async saveGroups(smartHome) {
        if (!smartHome || !smartHome.saveDeviceAnchor) return;
        for (const group of this.groups.values()) {
            await smartHome.saveDeviceAnchor({
                id: group.id,
                entity_id: group.id,
                name: group.name,
                area: group.area,
                type: 'lighting_group',
                memberIds: group.memberIds,
                isPositionLocked: !!group.isPositionLocked,
                position: group.position,
                quaternion: group.quaternion,
                label: group.name
            }).catch(e => console.warn(`[GroupManager] Failed to persist group ${group.id}:`, e));
        }
    }

    /**
     * Load existing groups from fetched Firestore anchors.
     */
    loadFromAnchors(savedAnchors = []) {
        for (const a of savedAnchors) {
            if (a.type === 'lighting_group' || a.id?.startsWith('group_light_')) {
                this.groups.set(a.id, {
                    id: a.id,
                    name: a.name || a.label || 'Lighting Group',
                    area: a.area || 'Other',
                    type: 'lighting_group',
                    memberIds: Array.isArray(a.memberIds) ? a.memberIds : [],
                    isOn: false,
                    brightness: 100,
                    colorTemp: 2700,
                    isPositionLocked: !!a.isPositionLocked,
                    position: a.position || { x: 0, y: 1.5, z: -1.5 },
                    quaternion: a.quaternion || { x: 0, y: 0, z: 0, w: 1 },
                    updatedAt: a.updatedAt || Date.now()
                });
            }
        }
        console.log(`[GroupManager] Loaded ${this.groups.size} lighting groups from anchors.`);
    }
}
