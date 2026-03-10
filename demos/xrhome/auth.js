/**
 * auth.js
 * Handles configuration storage and obtaining valid access tokens.
 */

const STORAGE_KEY = 'xrhome_config';

export class AuthManager {
  constructor() {
    this.config = this.loadConfig();
    this.accessToken = null;
  }

  loadConfig() {
    const stored = localStorage.getItem(STORAGE_KEY);
    const config = stored ? JSON.parse(stored) : { geminiKey: '', matterCode: '' };
    // Pre-fill from server-injected key if not saved by user yet.
    // Mark it so hasConfig() stays false until the user explicitly submits the form.
    if (!config.geminiKey && window.GEMINI_API_KEY) {
      config.geminiKey = window.GEMINI_API_KEY;
      this._keyFromServer = true;
    }
    return config;
  }

  saveConfig(newConfig) {
    console.log("AuthManager: Saving config", newConfig);
    this.config = { ...this.config, ...newConfig };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
  }

  hasConfig() {
    // Only auto-start if the key was explicitly saved by the user (not just server-injected)
    return !!this.config.geminiKey && !this._keyFromServer;
  }

  // Legacy OAuth methods removed as we are using Matter Multi-Admin now.
  async authenticate() {
      // No-op for Matter
      return;
  }

  getHeaders() {
    return {
      'Content-Type': 'application/json'
    };
  }
}
