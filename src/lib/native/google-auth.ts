import { registerPlugin } from '@capacitor/core';

/** Mirror of GoogleAuthPlugin.swift (service-account flavour). */
export interface GoogleAuthPlugin {
  /** Signs a JWT with the service-account key and exchanges it for an access token (cached ~1h). */
  getAccessToken(opts: {
    clientEmail: string;
    privateKey: string;
    /** Workspace user to impersonate via domain-wide delegation. */
    subject?: string;
    scopes: string[];
  }): Promise<{ accessToken: string }>;
}

export const GoogleAuth = registerPlugin<GoogleAuthPlugin>('GoogleAuth');
