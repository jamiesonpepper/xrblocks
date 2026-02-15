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
    return stored ? JSON.parse(stored) : {
      geminiKey: '',
      matterCode: ''
    };
  }

  saveConfig(newConfig) {
    console.log("AuthManager: Saving config", newConfig);
    this.config = { ...this.config, ...newConfig };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
  }

  hasConfig() {
    // We need at least Gemini Key to start
    return !!this.config.geminiKey;
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
