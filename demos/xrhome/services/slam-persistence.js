import { getDatabase, ref, set, onValue, remove } from "firebase/database";

export class SLAMPersistence {
    constructor(firebaseApp) {
        this.db = getDatabase(firebaseApp);
        this.anchorsRef = ref(this.db, 'anchors');
        this.activeAnchors = new Map(); // local tracking
    }

    /**
     * Listen to remote anchors from Firebase RTDB.
     */
    listen(onAnchorAdded, onAnchorRemoved) {
        onValue(this.anchorsRef, (snapshot) => {
            const data = snapshot.val() || {};
            
            // Check for new/updated anchors
            for (const [id, anchorData] of Object.entries(data)) {
                if (!this.activeAnchors.has(id)) {
                    this.activeAnchors.set(id, anchorData);
                    if (onAnchorAdded) onAnchorAdded(id, anchorData);
                }
            }

            // Check for removed anchors
            for (const id of this.activeAnchors.keys()) {
                if (!data[id]) {
                    this.activeAnchors.delete(id);
                    if (onAnchorRemoved) onAnchorRemoved(id);
                }
            }
        });
    }

    /**
     * Push a new anchor to Firebase.
     */
    async addAnchor(id, position, rotation, meta = {}) {
        const anchorData = {
            position: { x: position.x, y: position.y, z: position.z },
            rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
            timestamp: Date.now(),
            ...meta
        };
        await set(ref(this.db, `anchors/${id}`), anchorData);
    }

    /**
     * Remove an anchor from Firebase.
     */
    async removeAnchor(id) {
        await remove(ref(this.db, `anchors/${id}`));
    }
}
