/**
 * photoNormalize wired to the phone: expo-file-system reads the capture's
 * first bytes, expo-image-manipulator decodes it (JPEG, or HEIC on iPhone)
 * and saves a JPEG with its base64. All on the device.
 */
import { File } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';

import { readImageHeader } from '@/utils/imageHeader';

import { normalizePhoto, type NormalizedPhoto, type PhotoAction, type PhotoIO } from './photoNormalize';

const HEAD_BYTES = 256 * 1024;

function toManipulatorAction(action: PhotoAction): ImageManipulator.Action {
  if ('flip' in action) {
    return { flip: action.flip === 'horizontal' ? ImageManipulator.FlipType.Horizontal : ImageManipulator.FlipType.Vertical };
  }
  return action;
}

const deviceIO: PhotoIO = {
  readHead(uri) {
    try {
      const handle = new File(uri).open();
      try {
        const known = handle.size ?? 0;
        const head = handle.readBytes(known > 0 ? Math.min(known, HEAD_BYTES) : HEAD_BYTES);
        return { size: known > 0 ? known : head.length, head };
      } finally {
        handle.close();
      }
    } catch {
      return null;
    }
  },
  async encodeJpeg(uri, actions, quality) {
    const result = await ImageManipulator.manipulateAsync(uri, actions.map(toManipulatorAction), {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    });
    if (!result.base64) throw new Error('no image data');
    return { uri: result.uri, width: result.width, height: result.height, base64: result.base64 };
  },
  readHeader: readImageHeader,
};

/** A captured photo as an upright JPEG of at most 1600 px, checked byte by byte. */
export const normalizeEnrollmentPhoto = (uri: string): Promise<NormalizedPhoto> => normalizePhoto(uri, deviceIO);
