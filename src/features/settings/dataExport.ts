/**
 * "Download my data" (backend Oct 2026 §11.1) — device-side helpers.
 *
 * - The pending exportId is remembered per account on this device
 *   (SecureStore, localStorage on web) so the user can leave the screen and
 *   come back while the ZIP is built. One active export per account; asking
 *   again returns the same id.
 * - The ready file's `url` is a BFF path that needs the Authorization header
 *   (never open it in a browser): native downloads it with expo-file-system
 *   into the app's document directory; web fetches it and saves a blob.
 */
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { BFF_URL, getAccessToken } from '@/api/client';
import { trackNative } from '@/api/devNetworkLog';

const keyFor = (userId: string) => `truepas.export.${userId.replace(/[^A-Za-z0-9._-]/g, '_')}`;

async function readKey(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

async function writeKey(key: string, value: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (value == null) globalThis.localStorage?.removeItem(key);
      else globalThis.localStorage?.setItem(key, value);
    } catch {
      // private mode — memory only
    }
    return;
  }
  if (value == null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value);
}

/** The remembered exportId for this account (null = none). `loaded` turns
 *  true once storage has been read. */
export function useSavedExportId(userId?: string | null) {
  // Tagged with the account it was read for, so switching accounts never
  // shows another account's id while storage is read again.
  const [state, setState] = useState<{ userId: string; id: string | null } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    readKey(keyFor(userId))
      .catch(() => null)
      .then((v) => {
        if (alive) setState({ userId, id: v });
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  const save = (next: string | null) => {
    if (!userId) return;
    setState({ userId, id: next });
    void writeKey(keyFor(userId), next).catch(() => {});
  };

  const current = userId && state?.userId === userId ? state : null;
  return { exportId: current?.id ?? null, setExportId: save, loaded: !userId || current != null };
}

/** BFF path ("/user/me/export/…" or "/cb/user/me/export/…") → absolute URL. */
export function exportDownloadUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = BFF_URL.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  // BFF_URL already ends in /cb — don't double it when the path carries it.
  if (base.endsWith('/cb') && p.startsWith('/cb/')) return `${base.slice(0, -3)}${p}`;
  return `${base}${p}`;
}

export function exportFileName(date = new Date()): string {
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `truepas-data-${d}.zip`;
}

/**
 * Downloads the ready export with the access token.
 * Native → file:// URI in the app's document directory. Web → triggers a
 * browser download and returns null (nothing to share afterwards).
 */
export async function downloadExport(path: string): Promise<string | null> {
  const token = getAccessToken();
  const url = exportDownloadUrl(path);
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const name = exportFileName();

  if (Platform.OS === 'web') {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
    return null;
  }

  const { File, Paths } = await import('expo-file-system');
  const target = new File(Paths.document, name);
  // A native download no fetch/axios hook sees: logged here (development only).
  const file = await trackNative('GET', url, headers, () => File.downloadFileAsync(url, target, { headers, idempotent: true }),
    (saved) => ({ savedBytes: saved.size }));
  return file.uri;
}

/**
 * Android: copy the downloaded ZIP into a folder the user picks (Downloads,
 * Drive…) through the system picker — React Native's Share API can't attach
 * files there and expo-sharing isn't in this build. Returns false if the
 * user cancelled the picker.
 */
export async function saveExportToFolder(fileUri: string): Promise<boolean> {
  const { Directory, File } = await import('expo-file-system');
  let dir: InstanceType<typeof Directory>;
  try {
    dir = await Directory.pickDirectoryAsync();
  } catch {
    return false;
  }
  const src = new File(fileUri);
  const dest = dir.createFile(src.name || exportFileName(), 'application/zip');
  dest.write(await src.bytes());
  return true;
}
