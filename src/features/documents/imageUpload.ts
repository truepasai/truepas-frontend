/**
 * Document images on their way to the server: read, checked, and uploaded as
 * their own bytes.
 *
 * The scanner hands over base64: JPEG from the Android Document Reader and the
 * manual camera (expo-image-manipulator), PNG from the iOS Document Reader.
 * Those bytes are decoded in memory and PUT as they are, with no temporary
 * file in between: Android's fetch answers a missing local file with a 404
 * whose body ("File not found") once went up in place of a passport photo.
 * Nothing here trusts a read it has not checked.
 *
 * Before anything is sent, every image must be non-empty and a real JPEG or
 * PNG by its signature and header (a pixel size), whatever it was labelled.
 * It goes up with the content type of what it is. Any failure stops the
 * attempt before the upload with an ImageUploadError, whose message asks for
 * a new scan.
 *
 * Pure: the file system and the network come in as arguments
 * (imageUploadNative wires expo-file-system), so these rules run under
 * `node --test` (__tests__/imageUpload.test.mjs). Logs carry the source
 * scheme, sizes, formats and statuses; never image bytes, base64 or URLs.
 */
import type { DocLog } from '@/features/documents/verifyLog';
import type { DocumentImagePart } from '@/types/domain';

export type ImageFormat = 'jpeg' | 'png';
export type ImageContentType = 'image/jpeg' | 'image/png';
export type ImageBytes = Uint8Array<ArrayBuffer>;

/** Why an image can't be sent. */
export type ImageProblem = 'missing' | 'unreadable' | 'empty' | 'not_jpeg_or_png' | 'wrong_type';

export const RESCAN_MESSAGE = "We couldn't read the document photo on this phone. Please scan the document again.";

export class ImageUploadError extends Error {
  problem: ImageProblem;
  constructor(problem: ImageProblem, message: string = RESCAN_MESSAGE) {
    super(message);
    this.name = 'ImageUploadError';
    this.problem = problem;
  }
}

/** Server codes for an image it could not read: the same scan fails again. */
export const RESCAN_SERVER_CODES: readonly string[] = [
  'INVALID_DOCUMENT_IMAGE', 'DOCUMENT_IMAGE_TOO_LARGE', 'UNSUPPORTED_DOCUMENT_IMAGE',
];

/** Whether the way forward is a new scan rather than Retry: this phone
 *  couldn't read the scan, or the server couldn't. */
export function needsRescan(err: unknown, serverCode?: string | null): boolean {
  return err instanceof ImageUploadError || (serverCode != null && RESCAN_SERVER_CODES.includes(serverCode));
}

/* ── base64 ──────────────────────────────────────────────────────────── */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_VALUE = new Int8Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) B64_VALUE[B64.charCodeAt(i)] = i;

const isSpace = (c: number) => c === 10 || c === 13 || c === 32 || c === 9;

/** Every byte of a base64 image (a data: prefix allowed, line breaks skipped).
 *  Anything else in it makes the image unreadable: never partly decoded. */
export function base64ToBytes(base64: string): ImageBytes {
  const raw = base64.startsWith('data:') ? base64.slice(base64.indexOf(',') + 1) : base64;
  let digits = 0;
  let padding = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (isSpace(c)) continue;
    if (c === 61) { // '='
      padding++;
      continue;
    }
    if (padding || c > 127 || B64_VALUE[c] < 0) throw new ImageUploadError('unreadable');
    digits++;
  }
  if (padding > 2 || digits % 4 === 1) throw new ImageUploadError('unreadable');
  const out = new Uint8Array(Math.floor((digits * 6) / 8));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    const digit = c < 128 ? B64_VALUE[c] : -1;
    if (digit < 0) continue; // a line break or the padding, both checked above
    value = ((value << 6) | digit) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 255;
    }
  }
  return out;
}

/* ── what an image is ────────────────────────────────────────────────── */

export interface ImageInfo {
  format: ImageFormat;
  contentType: ImageContentType;
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const info = (format: ImageFormat, width: number, height: number): ImageInfo | null =>
  width > 0 && height > 0 ? { format, contentType: format === 'png' ? 'image/png' : 'image/jpeg', width, height } : null;

/** Format and pixel size from the signature and header, or null when the
 *  bytes are no JPEG or PNG: text, an error page, a broken or sizeless header.
 *  Nothing is decoded, and a real photo's size or quality is never judged. */
export function imageInfo(b: Uint8Array): ImageInfo | null {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1];
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  if (PNG_SIGNATURE.every((v, i) => b[i] === v)) {
    // IHDR comes first, its width and height right after the signature.
    if (b.length < 24 || String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null;
    return info('png', u32(16), u32(20));
  }
  if (b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) { // fill byte
      i += 1;
      continue;
    }
    // Start-of-frame markers (not DHT C4, JPG C8, DAC CC) carry the size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return info('jpeg', u16(i + 7), u16(i + 5));
    }
    const length = u16(i + 2);
    if (length < 2) return null;
    i += 2 + length;
  }
  return null;
}

/** The image's format and size, or ImageUploadError: empty, no JPEG or PNG,
 *  or (given `declared`) not what it was labelled. */
export function checkImage(bytes: Uint8Array, declared?: string): ImageInfo {
  if (!bytes.length) throw new ImageUploadError('empty');
  const found = imageInfo(bytes);
  if (!found) throw new ImageUploadError('not_jpeg_or_png');
  if (declared && declared !== found.contentType) throw new ImageUploadError('wrong_type');
  return found;
}

/* ── reading a local file ────────────────────────────────────────────── */

/** What reading a local file found: its bytes, or that it isn't there. */
export type FileRead = { found: true; bytes: ImageBytes } | { found: false; status?: number };

export interface ImageFileReader {
  read(uri: string): Promise<FileRead>;
}

/** A URI's scheme ("file", "content", "data"...) for the logs, never its path. */
export function uriScheme(uri: string): string {
  return /^([a-z][a-z0-9+.-]*):/i.exec(uri)?.[1].toLowerCase() ?? 'none';
}

/** A local image's bytes: a data: URI decoded here, anything else from
 *  `reader`. Missing, unreadable or empty is an ImageUploadError, so nothing
 *  that was not read is ever sent. */
export async function readImageFile(uri: string, reader: ImageFileReader): Promise<ImageBytes> {
  if (uri.startsWith('data:')) return base64ToBytes(uri);
  let result: FileRead;
  try {
    result = await reader.read(uri);
  } catch {
    throw new ImageUploadError('unreadable');
  }
  if (!result.found) throw new ImageUploadError('missing');
  if (!result.bytes.length) throw new ImageUploadError('empty');
  return result.bytes;
}

interface ReadResponse {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** A reader over fetch, for the web (no file system): only a 2xx is the file. */
export function fetchFileReader(fetchFn: (uri: string) => Promise<ReadResponse>): ImageFileReader {
  return {
    async read(uri) {
      const res = await fetchFn(uri);
      if (!res.ok) return { found: false, status: res.status };
      return { found: true, bytes: new Uint8Array(await res.arrayBuffer()) };
    },
  };
}

/* ── uploading ───────────────────────────────────────────────────────── */

export interface PutResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type PutFetch = (
  url: string,
  init: { method: 'PUT'; headers: Record<string, string>; body: ImageBytes },
) => Promise<PutResponse>;

/** PUT exactly `bytes` to a presigned URL, with the content type it was
 *  signed for. The HTTP status; a non-2xx throws with S3's error code. */
export async function putImage(fetchFn: PutFetch, uploadUrl: string, bytes: ImageBytes, contentType: string): Promise<number> {
  // Its own buffer: the body is these bytes, never the rest of a larger one.
  const body = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
  const res = await fetchFn(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body });
  if (!res.ok) {
    const code = (await res.text().catch(() => '')).match(/<Code>([^<]+)<\/Code>/)?.[1];
    throw new Error(`Upload failed (${res.status}${code ? ` ${code}` : ''})`);
  }
  return res.status;
}

/* ── the document flow ───────────────────────────────────────────────── */

type UploadLog = Pick<DocLog, 'info' | 'warn' | 'step'>;

export interface ImageSource {
  part: DocumentImagePart;
  uri?: string;
  base64?: string;
}

export interface PreparedImage extends ImageInfo {
  part: DocumentImagePart;
  data: ImageBytes;
  /** Where the bytes came from: "memory" (the scan's base64) or a URI scheme. */
  source: string;
}

/** One scanned image, read and checked. Logged by source, size and format. */
export async function prepareImage(image: ImageSource, reader: ImageFileReader, log: UploadLog): Promise<PreparedImage> {
  const fromMemory = image.base64 !== undefined;
  const source = fromMemory ? 'memory' : uriScheme(image.uri ?? '');
  log.info(`read ${image.part} started`, { source });
  try {
    const data = fromMemory ? base64ToBytes(image.base64 ?? '') : await readImageFile(image.uri ?? '', reader);
    const found = checkImage(data);
    log.info(`read ${image.part} ok`, {
      source, bytes: data.length, format: found.format, size: `${found.width}x${found.height}`,
    });
    return { ...found, part: image.part, data, source };
  } catch (err) {
    const failure = err instanceof ImageUploadError ? err : new ImageUploadError('unreadable');
    log.warn(`read ${image.part} failed`, { source, problem: failure.problem });
    throw failure;
  }
}

export interface UploadTarget {
  uploadUrl: string;
  objectKey: string;
}

export interface ImageUploadApi {
  getUploadUrls(
    parts: DocumentImagePart[],
    contentType: ImageContentType,
  ): Promise<{ uploads: Partial<Record<DocumentImagePart, UploadTarget>> }>;
  put(uploadUrl: string, data: ImageBytes, contentType: ImageContentType): Promise<number>;
}

/**
 * Upload checked images: presigned URLs for each content type (a front and
 * back from one scan share one request), then each image's own bytes. The
 * object keys, once every PUT has succeeded. `onPhase` says which step a
 * failure came from.
 */
export async function uploadImages(
  images: PreparedImage[],
  api: ImageUploadApi,
  log: UploadLog,
  onPhase?: (phase: 'urls' | 'put') => void,
): Promise<Partial<Record<DocumentImagePart, string>>> {
  const groups = new Map<ImageContentType, PreparedImage[]>();
  for (const image of images) groups.set(image.contentType, [...(groups.get(image.contentType) ?? []), image]);
  onPhase?.('urls');
  const uploads: Partial<Record<DocumentImagePart, UploadTarget>> = {};
  for (const [contentType, group] of groups) {
    const answer = await log.step(
      'upload-urls',
      () => api.getUploadUrls(group.map((image) => image.part), contentType),
      (r) => ({ parts: Object.keys(r.uploads ?? {}).join('+'), type: contentType }),
    );
    Object.assign(uploads, answer.uploads);
  }
  onPhase?.('put');
  await Promise.all(
    images.map((image) => {
      const target = uploads[image.part];
      if (!target) throw new Error("Couldn't start the upload. Please try again.");
      const sent = { bytes: image.data.length, type: image.contentType };
      log.info(`put ${image.part} started`, sent);
      return log.step(`put ${image.part}`, () => api.put(target.uploadUrl, image.data, image.contentType), (status) => ({
        status, ...sent,
      }));
    }),
  );
  const keys: Partial<Record<DocumentImagePart, string>> = {};
  for (const image of images) keys[image.part] = uploads[image.part]!.objectKey;
  return keys;
}
