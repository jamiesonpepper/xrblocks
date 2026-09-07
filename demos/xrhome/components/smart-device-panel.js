import * as THREE from "three";
import { SpatialPanel } from "xrblocks";

export class SmartDevicePanel {
    constructor(scene, camera, id, initialState = 'scanning') {
        this.scene = scene;
        this.camera = camera;
        this.id = id;
        this.state = initialState; // scanning, query, linked, error
        this.panel = new SpatialPanel({
            width: 0.4,
            height: 0.2, // Taller to fit icons comfortably
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#ffffff22', // Glimmer translucent light glass
            showEdge: true,
            edgeColor: '#ffffff',
            edgeWidth: 0.01 // Thick enough border to be visible constantly
        });

        this.onLinkRequest = null;
        this.onDeleteRequest = null;
        this.onTogglePower = null;
        
        this.scene.add(this.panel);
        this.updateUI();
    }

    setPosition(x, y, z) {
        this.panel.position.set(x, y, z);
        this.panel.lookAt(this.camera.position);
    }

    setState(newState, meta = {}) {
        this.state = newState;
        this.meta = meta;
        this.updateUI();
    }

    updateUI() {
        this.panel.clear();
        const grid = this.panel.addGrid();

        if (this.state === 'scanning') {
            this.panel.edgeColor = '#aaaa00'; // Yellow glowing edge
            grid.addRow({ weight: 0.4 }).addText({ text: "Found Device", fontSize: 0.08, fontColor: '#ffffff', textAlign: 'center' });
            
            const btnRow = grid.addRow({ weight: 0.6 });
            
            const linkBtn = btnRow.addCol({ weight: 0.5 }).addIconButton({ 
                text: "link", 
                backgroundColor: '#ffffff33', 
                fontColor: '#ffffff', 
                fontSize: 0.15 
            });
            linkBtn.onTriggered = () => {
                if (this.onLinkRequest) this.onLinkRequest(this.id);
            };
            
            const delBtn = btnRow.addCol({ weight: 0.5 }).addIconButton({
                text: "delete",
                backgroundColor: '#ff000033', // Subtle red glass
                fontColor: '#ffffff',
                fontSize: 0.15
            });
            delBtn.onTriggered = () => {
                if (this.onDeleteRequest) this.onDeleteRequest();
            };
        } 
        else if (this.state === 'mapping') {
            this.panel.edgeColor = '#4285f4'; // Blue glowing edge
            grid.addRow({ weight: 0.2 }).addText({ text: "Select Device to Link", fontSize: 0.06, fontColor: '#ffffff', textAlign: 'center' });
            
            if (this.devicesPayload && this.devicesPayload.size > 0) {
                const totalButtonSpace = 0.8;
                const buttonWeight = totalButtonSpace / this.devicesPayload.size;
                for (const [ghId, ghState] of this.devicesPayload.entries()) {
                    const btn = grid.addRow({ weight: buttonWeight }).addCol({ weight: 0.8 }).addTextButton({ 
                        text: ghState.name || ghId, 
                        backgroundColor: '#ffffff33', 
                        fontColor: '#ffffff', 
                        fontSize: 0.06 
                    });
                    btn.onTriggered = () => {
                        if (this.onMapComplete) this.onMapComplete(ghId, ghState.name || ghId);
                    };
                }
            } else {
                grid.addRow({ weight: 0.8 }).addText({ text: "No Devices Found", fontSize: 0.06, fontColor: '#ffaaaa', textAlign: 'center' });
            }
        }
        else if (this.state === 'query') {
            this.panel.edgeColor = '#ffffff';
            grid.addRow({ weight: 1.0 }).addText({ text: "Querying...", fontSize: 0.035, fontColor: '#ffffff', textAlign: 'center' });
        } 
        else if (this.state === 'linked') {
            this.panel.edgeColor = '#00aa00'; // Green glowing edge
            const name = this.meta?.name || "Linked Device";
            grid.addRow({ weight: 0.3 }).addText({ text: name, fontSize: 0.06, fontColor: '#ffffff', textAlign: 'center' });
            
            const isOn = this.meta?.on;
            const controlsRow = grid.addRow({ weight: 0.7 });
            
            // Power Button (power_settings_new)
            const pwrBtn = controlsRow.addCol({ weight: 0.25 }).addIconButton({ 
                text: "power_settings_new", 
                backgroundColor: isOn ? '#4285f4' : '#ffffff33', 
                fontColor: '#ffffff', 
                fontSize: 0.12 
            });
            pwrBtn.onTriggered = () => {
                if (this.onTogglePower) this.onTogglePower(this.id, !isOn);
            };
            
            // Color Palette
            const colorBtn = controlsRow.addCol({ weight: 0.25 }).addIconButton({ 
                text: "palette", 
                backgroundColor: '#ffffff33', 
                fontColor: '#ffffff', 
                fontSize: 0.12 
            });
            colorBtn.onTriggered = () => { console.log('Color palette selected'); };
            
            // Brightness Down
            const dimBtn = controlsRow.addCol({ weight: 0.25 }).addIconButton({ 
                text: "remove", 
                backgroundColor: '#ffffff33', 
                fontColor: '#ffffff', 
                fontSize: 0.12 
            });
            dimBtn.onTriggered = () => { console.log('Brightness diminished'); };
            
            // Brightness Up
            const brightBtn = controlsRow.addCol({ weight: 0.25 }).addIconButton({ 
                text: "add", 
                backgroundColor: '#ffffff33', 
                fontColor: '#ffffff', 
                fontSize: 0.12 
            });
            brightBtn.onTriggered = () => { console.log('Brightness increased'); };
            
        } 
        else if (this.state === 'error') {
            this.panel.edgeColor = '#cc0000'; // Red glowing edge
            grid.addRow({ weight: 1.0 }).addText({ text: "Sync Failed", fontSize: 0.035, fontColor: '#ffffff', textAlign: 'center' });
        }
        
        if (this.panel.updateLayouts) {
            this.panel.updateLayouts();
        }
    }

    showMappingUI(devicesPayload, callback) {
        this.onMapComplete = callback;
        this.devicesPayload = devicesPayload;
        this.setState('mapping');
    }

    remove() {
        this.scene.remove(this.panel);
        this.panel.dispose();
    }
}
