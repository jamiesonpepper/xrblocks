import * as THREE from "three";
import * as xb from "xrblocks";

export class SmartDevicePanel {
    constructor(scene, camera, id, initialState = 'scanning') {
        this.scene = scene;
        this.camera = camera;
        this.id = id;
        this.state = initialState; // scanning, query, linked, error
        this.panel = null;

        this.onLinkRequest = null;
        this.onDeleteRequest = null;
        this.onTogglePower = null;
        
        this.updateUI();
    }

    setPosition(x, y, z) {
        if (this.panel) {
            this.panel.position.set(x, y, z);
            this.panel.lookAt(this.camera.position);
        }
    }

    setState(newState, meta = {}) {
        this.state = newState;
        this.meta = meta;
        this.updateUI();
    }

    updateUI() {
        if (this.panel) {
            this.scene.remove(this.panel);
        }

        const children = [];

        if (this.state === 'scanning') {
            children.push(new xb.UIText({ text: "Found Device", style: { fontSize: 16, color: '#ffffff', textAlign: 'center' } }));
            
            const linkBtn = new xb.UIButton({
                label: "Link",
                icon: "link",
                style: { flexGrow: 1, borderRadius: 8 },
                onClick: () => { if (this.onLinkRequest) this.onLinkRequest(this.id); }
            });
            const delBtn = new xb.UIButton({
                label: "Delete",
                icon: "delete",
                style: { flexGrow: 1, borderRadius: 8 },
                onClick: () => { if (this.onDeleteRequest) this.onDeleteRequest(); }
            });
            
            children.push(new xb.UIPanel({
                style: { width: '100%', flexDirection: 'row', gap: 8 },
                children: [linkBtn, delBtn]
            }));
        } 
        else if (this.state === 'mapping') {
            children.push(new xb.UIText({ text: "Select Device to Link", style: { fontSize: 16, color: '#ffffff', textAlign: 'center' } }));
            
            if (this.devicesPayload && this.devicesPayload.size > 0) {
                for (const [ghId, ghState] of this.devicesPayload.entries()) {
                    children.push(new xb.UIButton({
                        label: ghState.name || ghId,
                        style: { width: '100%', borderRadius: 8 },
                        onClick: () => { if (this.onMapComplete) this.onMapComplete(ghId, ghState.name || ghId); }
                    }));
                }
            } else {
                children.push(new xb.UIText({ text: "No Devices Found", style: { fontSize: 14, color: '#ffaaaa', textAlign: 'center' } }));
            }
        }
        else if (this.state === 'query') {
            children.push(new xb.UIText({ text: "Querying...", style: { fontSize: 14, color: '#ffffff', textAlign: 'center' } }));
        } 
        else if (this.state === 'linked') {
            const name = this.meta?.name || "Linked Device";
            children.push(new xb.UIText({ text: name, style: { fontSize: 16, color: '#ffffff', textAlign: 'center' } }));
            
            const isOn = this.meta?.on;
            const pwrBtn = new xb.UIButton({
                label: isOn ? "Off" : "On",
                icon: "power_settings_new",
                style: { flexGrow: 1, borderRadius: 8 },
                onClick: () => { if (this.onTogglePower) this.onTogglePower(this.id, !isOn); }
            });
            children.push(pwrBtn);
        } 
        else if (this.state === 'error') {
            children.push(new xb.UIText({ text: "Sync Failed", style: { fontSize: 14, color: '#cc0000', textAlign: 'center' } }));
        }

        this.panel = new xb.UICard({
            size: { width: 0.4, height: 'auto' },
            manipulation: true,
            style: {
                flexDirection: 'column',
                gap: 8,
                padding: 12,
                backgroundColor: 'rgba(20, 20, 25, 0.85)',
                borderRadius: 12,
            },
            children
        });

        this.scene.add(this.panel);
    }

    showMappingUI(devicesPayload, callback) {
        this.onMapComplete = callback;
        this.devicesPayload = devicesPayload;
        this.setState('mapping');
    }

    remove() {
        if (this.panel) {
            this.scene.remove(this.panel);
        }
    }
}
