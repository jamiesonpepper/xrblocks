/**
 * auth.js
 * Handles multi-user Google Authentication via Firebase Auth,
 * secure user-isolated configuration storage for Gemini and Home Assistant API keys,
 * and access token management.
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
    getAuth, 
    signInWithPopup, 
    signOut, 
    GoogleAuthProvider, 
    onAuthStateChanged 
} from 'firebase/auth';
import { getDatabase, ref, set, get } from 'firebase/database';

const STORAGE_KEY_PREFIX = 'xrhome_user_config_';
const LEGACY_STORAGE_KEY = 'xrhome_config';

export class AuthManager {
  constructor() {
    this.firebaseApp = null;
    this.auth = null;
    this.db = null;
    this.currentUser = null;
    this.config = this.loadLegacyConfig();
    this.onUserChanged = null;
  }

  loadLegacyConfig() {
    try {
      const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
      return stored ? JSON.parse(stored) : {
        geminiKey: '',
        haToken: '',
        haUrl: '',
        matterCode: ''
      };
    } catch (e) {
      return { geminiKey: '', haToken: '', haUrl: '', matterCode: '' };
    }
  }

  /**
   * Initializes Firebase Auth and Realtime Database with the provided configuration.
   * @param {Object} firebaseConfig
   */
  initFirebase(firebaseConfig) {
    if (!firebaseConfig || !firebaseConfig.apiKey) {
      console.warn("[AuthManager] Incomplete Firebase configuration provided.");
      return null;
    }

    try {
      if (!getApps().length) {
        this.firebaseApp = initializeApp(firebaseConfig);
      } else {
        this.firebaseApp = getApp();
      }

      this.auth = getAuth(this.firebaseApp);
      this.db = getDatabase(this.firebaseApp);

      // Listen to auth state transitions
      onAuthStateChanged(this.auth, async (user) => {
        this.currentUser = user;
        if (user) {
          console.log(`[AuthManager] Authenticated user: ${user.displayName || user.email} (${user.uid})`);
          await this.loadUserConfig(user.uid);
        } else {
          console.log("[AuthManager] No authenticated user. Reverting to local/legacy config.");
          this.config = this.loadLegacyConfig();
        }

        if (this.onUserChanged) {
          this.onUserChanged(user, this.config);
        }
      });

      return { auth: this.auth, db: this.db };
    } catch (err) {
      console.error("[AuthManager] Firebase initialization error:", err);
      return null;
    }
  }

  /**
   * Sign in using Google OAuth popup.
   * @returns {Promise<User>}
   */
  async signInWithGoogle() {
    if (!this.auth) {
      throw new Error("Firebase Auth has not been initialized yet.");
    }
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await signInWithPopup(this.auth, provider);
    this.currentUser = result.user;
    await this.loadUserConfig(result.user.uid);
    return result.user;
  }

  /**
   * Sign out the current user.
   */
  async signOut() {
    if (!this.auth) return;
    await signOut(this.auth);
    this.currentUser = null;
    this.config = this.loadLegacyConfig();
    if (this.onUserChanged) {
      this.onUserChanged(null, this.config);
    }
  }

  /**
   * Loads configuration isolated strictly to the user's UID.
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  async loadUserConfig(userId) {
    if (!userId) return this.config;

    // 1. Check local cache for this specific user
    try {
      const cached = localStorage.getItem(`${STORAGE_KEY_PREFIX}${userId}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        this.config = { ...this.config, ...parsed };
      }
    } catch (e) {
      console.warn("[AuthManager] Error reading local user cache:", e);
    }

    // 2. Fetch from Firebase RTDB under users/{userId}/config
    if (this.db) {
      try {
        const snapshot = await get(ref(this.db, `users/${userId}/config`));
        if (snapshot.exists()) {
          const remoteData = snapshot.val();
          this.config = {
            ...this.config,
            geminiKey: remoteData.geminiKey || this.config.geminiKey || '',
            haToken: remoteData.haToken || this.config.haToken || '',
            haUrl: remoteData.haUrl || this.config.haUrl || ''
          };
          // Update local user cache
          localStorage.setItem(`${STORAGE_KEY_PREFIX}${userId}`, JSON.stringify(this.config));
          console.log(`[AuthManager] Successfully loaded remote config for user ${userId}`);
        }
      } catch (err) {
        console.warn(`[AuthManager] Could not fetch remote user config for ${userId}:`, err);
      }
    }

    return this.config;
  }

  /**
   * Saves credentials specifically under the authenticated user profile.
   * Enforces that only the authenticated user's record is written.
   * @param {Object} newConfig
   * @param {string} [userId]
   */
  async saveUserConfig(newConfig, userId = null) {
    const uid = userId || (this.currentUser ? this.currentUser.uid : null);
    this.config = { ...this.config, ...newConfig };

    if (uid) {
      // Save to isolated local cache for this user
      try {
        localStorage.setItem(`${STORAGE_KEY_PREFIX}${uid}`, JSON.stringify(this.config));
      } catch (e) {
        console.warn("[AuthManager] Local user cache save error:", e);
      }

      // Save to Firebase RTDB scoped strictly to users/{uid}/config
      if (this.db) {
        try {
          await set(ref(this.db, `users/${uid}/config`), {
            geminiKey: this.config.geminiKey || '',
            haToken: this.config.haToken || '',
            haUrl: this.config.haUrl || '',
            updatedAt: Date.now()
          });
          console.log(`[AuthManager] Securely stored credentials under users/${uid}/config`);
        } catch (err) {
          console.error(`[AuthManager] Failed to persist credentials for user ${uid}:`, err);
          throw err;
        }
      }
    } else {
      // Fallback for unauthenticated/demo sessions
      localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(this.config));
    }

    return this.config;
  }

  /**
   * Backward-compatible config save.
   */
  saveConfig(newConfig) {
    return this.saveUserConfig(newConfig);
  }

  hasConfig() {
    return !!this.config.geminiKey;
  }

  getUserId() {
    return this.currentUser ? this.currentUser.uid : null;
  }

  getUser() {
    return this.currentUser;
  }

  async getIdToken() {
    if (this.currentUser && typeof this.currentUser.getIdToken === 'function') {
      return await this.currentUser.getIdToken();
    }
    return null;
  }

  async getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const token = await this.getIdToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const uid = this.getUserId();
    if (uid) {
      headers['x-user-id'] = uid;
    }
    return headers;
  }
}
