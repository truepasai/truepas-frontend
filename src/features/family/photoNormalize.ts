/**
 * The under-5 enrolment photo, prepared on the phone before it is sent: a
 * real JPEG (an iPhone captures HEIC, which the face service can't read),
 * upright, at most PHOTO_LONG_SIDE px on its longest side, and checked byte
 * by byte — the base64 that goes up is exactly the JPEG that was checked.
 * Nothing is sent anywhere to be converted.
 *
 * Pure: the image work comes in through PhotoIO (photoNormalizeNative wires
 * expo-image-manipulator and expo-file-system), so these rules run under
 * `node --test` (__tests__/photoNormalize.test.mjs).
 *
 * Why 1600 px: face-opensource finds faces on a 640x640 copy and builds the
 * embedding from a 112x112 crop of the original, so 1600 px keeps far more
 * than either step uses while a 12 MP capture (several MB, a third more as
 * base64) becomes a few hundred KB. It does not make recognition succeed by
 * itself — the face check on this same image (photoQuality) decides whether
 * it is sent.
 */
import type { ImageHeader } from '@/utils/imageHeader';

export const PHOTO_LONG_SIDE = 1600;
export const PHOTO_QUALITY = 0.85;
/** One smaller re-encode when the first comes out over MAX_PHOTO_BYTES. */
export const PHOTO_RETRY_QUALITY = 0.7;
/** Quality of the full-size decode of a photo whose size the header can't give (HEIC). */
const DECODE_QUALITY = 0.92;
/** Well under face-opensource's 8 MB image limit and the BFF's 20 MB body. */
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

export type PhotoAction =
  | { resize: { width: number } | { height: number } }
  | { rotate: number }
  | { flip: 'horizontal' | 'vertical' };

/** A JPEG saved on the phone, with its base64 (what is uploaded). */
export interface EncodedImage {
  uri: string;
  width: number;
  height: number;
  base64: string;
}

export interface PhotoIO {
  /** A local file's size and first bytes, or null when it can't be read. */
  readHead(uri: string): { size: number; head: Uint8Array } | null;
  /** Decode (JPEG, HEIC…), apply the actions in order, save as JPEG with base64. */
  encodeJpeg(uri: string, actions: PhotoAction[], quality: number): Promise<EncodedImage>;
  /** utils/imageHeader readImageHeader: JPEG or PNG only, null otherwise. */
  readHeader(bytes: Uint8Array): ImageHeader | null;
}

export type PhotoProblem = 'empty' | 'unreadable' | 'not_jpeg' | 'too_large';

export class PhotoNormalizeError extends Error {
  problem: PhotoProblem;
  constructor(problem: PhotoProblem, message: string) {
    super(message);
    this.name = 'PhotoNormalizeError';
    this.problem = problem;
  }
}

export interface NormalizedPhoto extends EncodedImage {
  /** Bytes the base64 decodes to — the JPEG that is uploaded. */
  bytes: number;
  /** "4032x3024 exif=6 3100KB → 1200x1600 412KB": sizes only, for logs. */
  label: string;
}

const RETAKE = 'Please take the photo again.';

/** Upright size of a stored image: a quarter-turn EXIF tag swaps the sides. */
export function uprightSize(header: ImageHeader): { width: number; height: number } {
  return isQuarterTurn(header.orientation)
    ? { width: header.height, height: header.width }
    : { width: header.width, height: header.height };
}

const isQuarterTurn = (orientation: number) => orientation >= 5 && orientation <= 8;

/** The resize that brings the longest side down to `longSide`, keeping the
 *  aspect ratio, or null when it already fits — a photo is never enlarged. */
export function resizeFor(width: number, height: number, longSide = PHOTO_LONG_SIDE): PhotoAction | null {
  if (Math.max(width, height) <= longSide) return null;
  return width >= height ? { resize: { width: longSide } } : { resize: { height: longSide } };
}

/** Turns that make stored pixels upright for an EXIF orientation. Used only
 *  when decoding kept the pixels as stored instead of applying the tag. */
export function exifActions(orientation: number): PhotoAction[] {
  switch (orientation) {
    case 2:
      return [{ flip: 'horizontal' }];
    case 3:
      return [{ rotate: 180 }];
    case 4:
      return [{ flip: 'vertical' }];
    case 5:
      return [{ rotate: 90 }, { flip: 'horizontal' }];
    case 6:
      return [{ rotate: 90 }];
    case 7:
      return [{ rotate: 270 }, { flip: 'horizontal' }];
    case 8:
      return [{ rotate: 270 }];
    default:
      return [];
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_VALUE = new Map([...B64].map((c, i) => [c, i]));
/** Standard base64, no line breaks or data: prefix — what the BFF decodes strictly. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Bytes a base64 string decodes to. */
export function base64Size(base64: string): number {
  if (!base64) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

/** Decode whole 4-character groups. */
function decodeGroups(chars: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 3 < chars.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (chars[i + k] === '=' ? 0 : B64_VALUE.get(chars[i + k]) ?? 0));
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    out.push((n >> 16) & 255);
    if (chars[i + 2] !== '=') out.push((n >> 8) & 255);
    if (chars[i + 3] !== '=') out.push(n & 255);
  }
  return out;
}

/** The first `maxBytes` and the last two bytes of what `base64` decodes to. */
export function base64Ends(base64: string, maxBytes: number): { head: Uint8Array; tail: Uint8Array } {
  const head = decodeGroups(base64.slice(0, Math.ceil(maxBytes / 3) * 4)).slice(0, maxBytes);
  const tail = decodeGroups(base64.slice(Math.max(0, base64.length - 8))).slice(-2);
  return { head: Uint8Array.from(head), tail: Uint8Array.from(tail) };
}

/**
 * The encoded image's byte size, after checking that its base64 really is a
 * complete JPEG of the reported size: clean base64, JPEG start and end
 * markers, and a header that agrees with width and height. Throws
 * PhotoNormalizeError('not_jpeg') otherwise.
 */
export function checkJpeg(image: EncodedImage, readHeader: PhotoIO['readHeader']): number {
  const notJpeg = (why: string) => new PhotoNormalizeError('not_jpeg', `The photo couldn't be prepared (${why}). ${RETAKE}`);
  if (!image.base64 || image.base64.length % 4 !== 0 || !BASE64.test(image.base64)) throw notJpeg('bad encoding');
  const { head, tail } = base64Ends(image.base64, 64 * 1024);
  const startsJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const endsJpeg = tail.length === 2 && tail[0] === 0xff && tail[1] === 0xd9;
  const header = readHeader(head);
  if (!startsJpeg || !endsJpeg || header?.format !== 'jpeg') throw notJpeg('not a complete JPEG');
  const size = uprightSize(header);
  if (size.width !== image.width || size.height !== image.height) throw notJpeg('size mismatch');
  return base64Size(image.base64);
}

/** True when the output's orientation disagrees with the expected upright shape. */
const turnedWrong = (image: { width: number; height: number }, upright: { width: number; height: number }) =>
  upright.width !== upright.height && image.width > image.height !== upright.width > upright.height;

const kb = (bytes: number) => `${Math.round(bytes / 1024)}KB`;

/**
 * Prepare a captured photo for enrolment. Throws PhotoNormalizeError with a
 * message the screen can show: an empty or unreadable capture, an output
 * that isn't a complete JPEG, or one still over MAX_PHOTO_BYTES.
 */
export async function normalizePhoto(uri: string, io: PhotoIO): Promise<NormalizedPhoto> {
  const source = io.readHead(uri);
  if (!source) throw new PhotoNormalizeError('unreadable', `The photo couldn't be read. ${RETAKE}`);
  if (source.size === 0 || source.head.length === 0) {
    throw new PhotoNormalizeError('empty', `The photo came out empty. ${RETAKE}`);
  }
  const encode = async (from: string, actions: PhotoAction[], quality: number) => {
    try {
      return await io.encodeJpeg(from, actions, quality);
    } catch {
      throw new PhotoNormalizeError('unreadable', `This photo couldn't be converted. ${RETAKE}`);
    }
  };

  const header = io.readHeader(source.head);
  let from = uri;
  let upright: { width: number; height: number };
  if (header) {
    upright = uprightSize(header);
  } else {
    // HEIC (or another format the header reader doesn't know): decode it to
    // a full-size upright JPEG first, to learn its size.
    const decoded = await encode(uri, [], DECODE_QUALITY);
    from = decoded.uri;
    upright = { width: decoded.width, height: decoded.height };
  }
  if (!(upright.width > 0 && upright.height > 0)) {
    throw new PhotoNormalizeError('unreadable', `The photo couldn't be read. ${RETAKE}`);
  }
  const resize = resizeFor(upright.width, upright.height);
  const sizeActions = resize ? [resize] : [];

  let actions = sizeActions;
  let out = await encode(from, actions, PHOTO_QUALITY);
  if (header && isQuarterTurn(header.orientation) && turnedWrong(out, upright)) {
    // Decoding kept the pixels as stored and dropped the EXIF tag, which
    // would send the face sideways: turn them here.
    actions = [...exifActions(header.orientation), ...sizeActions];
    out = await encode(from, actions, PHOTO_QUALITY);
    if (turnedWrong(out, upright)) {
      throw new PhotoNormalizeError('unreadable', `The photo couldn't be turned upright. ${RETAKE}`);
    }
  }
  if (Math.max(out.width, out.height) > PHOTO_LONG_SIDE + 1) {
    throw new PhotoNormalizeError('not_jpeg', `The photo couldn't be resized. ${RETAKE}`);
  }

  let bytes = checkJpeg(out, io.readHeader);
  if (bytes > MAX_PHOTO_BYTES) {
    out = await encode(from, actions, PHOTO_RETRY_QUALITY);
    bytes = checkJpeg(out, io.readHeader);
    if (bytes > MAX_PHOTO_BYTES) {
      throw new PhotoNormalizeError('too_large', `The photo is too large to send. ${RETAKE}`);
    }
  }
  const before = header
    ? `${header.width}x${header.height}${header.orientation !== 1 ? ` exif=${header.orientation}` : ''} ${kb(source.size)}`
    : `unknown format ${kb(source.size)}`;
  return { ...out, bytes, label: `${before} → ${out.width}x${out.height} ${kb(bytes)}` };
}
