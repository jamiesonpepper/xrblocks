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
      projectId: '',
      clientId: '',
      projectId: '',
      clientId: '',
      clientSecret: '', // Note: storing client secret in local storage is not secure for prod, but ok for this local PoC
      redirectUri: ''
    };
  }

  saveConfig(newConfig) {
    console.log("AuthManager: Saving config", newConfig);
    this.config = { ...this.config, ...newConfig };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
  }

  hasConfig() {
    // We need at least Gemini Key and Project ID to start reasonable demos
    return this.config.geminiKey && this.config.projectId;
  }

  /**
   * For this PoC, we will assume the user might paste an Access Token manually 
   * OR we conduct a simplified OAuth flow if they provide ClientID/Secret.
   * To keep it simple for the "Proof of Concept" where oAuth2 prompt is requested:
   * We will trigger the Google OAuth 2.0 Implicit Flow.
   */
  async authenticate() {
    console.log("Authenticating...");
    if (!this.config.clientId) {
      console.warn("No Client ID provided. Skipping OAuth.");
      return; // Or throw error
    }

    // Check if we have a token in the URL hash (callback from OAuth)
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    if (hashParams.has('access_token')) {
      this.accessToken = hashParams.get('access_token');
      // Clear hash
      window.history.replaceState(null, null, ' ');
      console.log("Access Token retrieved from URL.");
      return;
    }

    // If no token, we might need to redirect
    // BUT checking validity first would be better.
    // For PoC, just force redirect if no token is known.
    if (!this.accessToken) {
        console.log("No access token found, initiating OAuth flow...");
        this.initiateOAuth();
    } else {
        console.log("Existing access token found.");
    }
  }

  initiateOAuth() {
    const authEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth';
    const scope = 'https://www.googleapis.com/auth/sdm.service';
    
    // Use configured URI or fallback to current location (cleaned) behavior
    let redirectUri = this.config.redirectUri;
    if (!redirectUri) {
         redirectUri = window.location.origin + window.location.pathname;
         if (redirectUri.endsWith('/')) redirectUri = redirectUri.slice(0, -1);
    }
    console.log("Using Redirect URI:", redirectUri);

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'token',
      scope: scope,
      include_granted_scopes: 'true',
      state: 'pass-through-value'
    });

    window.location.href = `${authEndpoint}?${params.toString()}`;
  }

  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.accessToken}`
    };
  }
}
