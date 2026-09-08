import sa from './service-account.json';

/**
 * Google Drive settings.
 *
 * Auth is a Service Account (no sign-in). `service-account.json` is the key file downloaded
 * from Google Cloud Console; it is git-ignored because it contains a private key.
 * `impersonate` is the Workspace user the robot acts as (domain-wide delegation), so files
 * it uploads are owned by that user and land in their Drive.
 */
export const DRIVE_CONFIG = {
  clientEmail: sa.client_email,
  privateKey: sa.private_key,
  impersonate: 'ben@binary1702.com',
  /** The Drive folder that is the master music library ("winamp"). */
  rootFolderId: '1BGjBYLG0xvKN1GBTc0KzlHZK6jD-uZ0z',
  /** Full Drive scope: we read the library AND upload phone recordings into it. */
  scopes: ['https://www.googleapis.com/auth/drive'],
};

export const driveConfigured = () => Boolean(DRIVE_CONFIG.clientEmail && DRIVE_CONFIG.privateKey);
