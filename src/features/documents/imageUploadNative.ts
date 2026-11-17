/**
 * imageUpload wired to the phone: expo-file-system reads a local image's
 * bytes (file:// or content://). Never fetch(file://): on Android it answers
 * a missing file with a 404 whose "File not found" body reads like data. The
 * web has no file system, so a blob: or data: URI is fetched there, and only
 * a 2xx answer counts as the file.
 */
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { fetchFileReader, type ImageFileReader } from './imageUpload';

const fileSystemReader: ImageFileReader = {
  async read(uri) {
    const file = new File(uri);
    if (!file.exists) return { found: false };
    return { found: true, bytes: await file.bytes() };
  },
};

export const localImageReader: ImageFileReader =
  Platform.OS === 'web' ? fetchFileReader((uri) => fetch(uri)) : fileSystemReader;
