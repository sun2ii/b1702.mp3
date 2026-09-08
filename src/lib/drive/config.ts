/**
 * Google Drive settings. The client ID is public by design (iOS OAuth clients have no secret);
 * security comes from the redirect scheme being bound to this app's bundle ID.
 */
export const DRIVE_CONFIG = {
  /** OAuth client ID of type "iOS" from Google Cloud Console → Credentials. */
  clientId: 'PASTE_YOUR_IOS_CLIENT_ID.apps.googleusercontent.com',
  /** The Drive folder that is the master music library ("winamp"). */
  rootFolderId: '1BGjBYLG0xvKN1GBTc0KzlHZK6jD-uZ0z',
  /** Read-only: Drive is the master, the phone never writes to it. */
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
};

export const driveConfigured = () => !DRIVE_CONFIG.clientId.startsWith('PASTE_');
