import { registerPlugin } from '@capacitor/core';

/** Mirror of GoogleAuthPlugin.swift. */
export interface GoogleAuthPlugin {
  signIn(opts: { clientId: string; scopes: string[] }): Promise<{ accessToken: string }>;
  /** Returns a valid access token, silently refreshing when expired. Rejects with "Not signed in". */
  getAccessToken(): Promise<{ accessToken: string }>;
  signOut(): Promise<void>;
  isSignedIn(): Promise<{ signedIn: boolean }>;
}

export const GoogleAuth = registerPlugin<GoogleAuthPlugin>('GoogleAuth');
