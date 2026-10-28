/**
 * The liveness finalize frame — the photo that becomes the enrolled face,
 * which documents are later matched against (backend §6.4).
 *
 * On Android, VisionCamera saves through CameraX, which keeps the sensor's
 * pixel orientation and records the rotation (and front-camera mirroring) in
 * the EXIF orientation tag. A server that ignores the tag sees the face on
 * its side, so the frame is turned upright here before upload.
 */
import { File } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';

import { describeImage, isQuarterTurn, readImageHeader, type ImageHeader } from '@/utils/imageHeader';

const HEAD_BYTES = 256 * 1024;

/** Header and a one-line description ("4000x3000 exif=6 2310KB") of a local image. */
export function inspectImageFile(uri: string): { header: ImageHeader | null; label: string } {
  try {
    const handle = new File(uri).open();
    try {
      const size = handle.size ?? 0;
      const head = handle.readBytes(size > 0 ? Math.min(size, HEAD_BYTES) : HEAD_BYTES);
      const header = readImageHeader(head);
      return { header, label: describeImage(header, size || head.length) };
    } finally {
      handle.close();
    }
  } catch (e) {
    return { header: null, label: `unreadable (${e instanceof Error ? e.message : String(e)})` };
  }
}

export interface UprightFrame {
  /** The file to upload. */
  uri: string;
  /** The captured file, e.g. "4000x3000 exif=6 2310KB". */
  before: string;
  /** The rotated copy, when one was made. */
  after?: string;
  note: string;
}

/**
 * The frame with a quarter-turn EXIF rotation baked into the pixels. The copy
 * is used only if it really came out turned (its aspect flipped); otherwise
 * the original goes up with its EXIF tag intact.
 *
 * A frame that isn't JPEG or PNG (e.g. HEIC from an iOS camera) is re-encoded
 * as an upright JPEG — the backend can't decode anything else.
 */
export async function uprightFrame(uri: string): Promise<UprightFrame> {
  const { header, label } = inspectImageFile(uri);
  if (!header) {
    try {
      const out = await ImageManipulator.manipulateAsync(uri, [], {
        compress: 0.95,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      return { uri: out.uri, before: label, after: inspectImageFile(out.uri).label, note: 'not JPEG/PNG, re-encoded as JPEG' };
    } catch (e) {
      return { uri, before: label, note: `not JPEG/PNG, re-encode failed (${e instanceof Error ? e.message : String(e)}), sent as captured` };
    }
  }
  if (!isQuarterTurn(header.orientation)) return { uri, before: label, note: 'already upright' };
  try {
    const out = await ImageManipulator.manipulateAsync(uri, [], {
      compress: 0.95,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    if (out.width > out.height === header.width > header.height) {
      // Pixels kept as stored: the copy would lose the EXIF tag and leave the face sideways.
      return { uri, before: label, after: `${out.width}x${out.height}`, note: 'not rotated, sent as captured' };
    }
    return { uri: out.uri, before: label, after: inspectImageFile(out.uri).label, note: 'rotated upright' };
  } catch (e) {
    return { uri, before: label, note: `rotation failed (${e instanceof Error ? e.message : String(e)}), sent as captured` };
  }
}
