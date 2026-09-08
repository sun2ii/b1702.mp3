import { GoogleAuth } from '../native/google-auth';
import { DRIVE_CONFIG } from './config';

/**
 * The tiny slice of the Drive v3 REST API we need. Calls go straight from the WebView to
 * googleapis.com with a bearer token; no SDK.
 */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  createdTime?: string;
  /** Folder names from the root down to this file's parent, e.g. ["Daft Punk", "Discovery"]. */
  pathParts: string[];
}

const API = 'https://www.googleapis.com/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|aiff?|flac|alac)$/i;

/** One place that knows how to get a token. Everything else just asks for a header. */
export async function accessToken(): Promise<string> {
  const { accessToken } = await GoogleAuth.getAccessToken({
    clientEmail: DRIVE_CONFIG.clientEmail,
    privateKey: DRIVE_CONFIG.privateKey,
    subject: DRIVE_CONFIG.impersonate,
    scopes: DRIVE_CONFIG.scopes,
  });
  return accessToken;
}

async function authHeader() {
  return { Authorization: `Bearer ${await accessToken()}` };
}

async function listChildren(folderId: string): Promise<Omit<DriveFile, 'pathParts'>[]> {
  const out: Omit<DriveFile, 'pathParts'>[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, createdTime)',
      pageSize: '1000',
      ...(pageToken ? { pageToken } : {}),
    });
    const res = await fetch(`${API}/files?${params}`, { headers: await authHeader() });
    if (!res.ok) throw new Error(`Drive list failed (HTTP ${res.status})`);
    const json = await res.json();
    out.push(...json.files);
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

/** Walk the folder tree and return every audio file with its folder path. */
export async function listAudioFiles(rootId: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  const walk = async (id: string, pathParts: string[]) => {
    for (const f of await listChildren(id)) {
      if (f.mimeType === FOLDER) await walk(f.id, [...pathParts, f.name]);
      else if (f.mimeType.startsWith('audio/') || AUDIO_EXT.test(f.name)) files.push({ ...f, pathParts });
    }
  };
  await walk(rootId, []);
  return files;
}

/**
 * Drive "resumable upload", step 1 of 2: register name + parent folder, get back a session URI.
 * Step 2 (the bytes) is done natively from disk — see AudioEngine.uploadFile.
 */
export async function createUploadSession(name: string, parentId: string, mimeType: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ name, parents: [parentId], mimeType }),
  });
  if (!res.ok) throw new Error(`Drive upload init failed (HTTP ${res.status})`);
  const uri = res.headers.get('Location');
  if (!uri) throw new Error('Drive did not return an upload session URI');
  return uri;
}

export function downloadUrl(fileId: string) {
  return `${API}/files/${fileId}?alt=media`;
}
