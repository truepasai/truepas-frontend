/**
 * Is there exactly one clearly visible face in the photo about to be
 * enrolled? Checked on the prepared JPEG itself — the exact image that is
 * uploaded, not a preview frame — with ML Kit's still-image face detector.
 * For members under 5 this is the whole check: face presence only, no
 * liveness, no face match, no identity check. The face service still has to
 * find the face to store it, so passing here does not guarantee it does.
 *
 * What is checked, and why: the file is still readable and has a size;
 * exactly one face; the face is inside the photo and large enough for the
 * face service's 112 px crop. ML Kit reports nothing about light or blur and
 * the app has no other reliable local measure, so neither is checked.
 *
 * A detector failure is never a silent "no verdict": it keeps its technical
 * reason (`detail`, for logs only) and says which part failed — the file, the
 * detector's creation on this phone, ML Kit while it ran, or the detector
 * library's own still-photo defect (`detector_defect`: in 2.0.6 its native
 * code refused every photo, "Invalid image type"; patches/ fixes it, so an
 * app still showing it needs updating). None of them is a face verdict.
 *
 * Pure, so it runs under `node --test` (__tests__/photoQuality.test.mjs).
 */

export interface DetectedFace {
  bounds: { x: number; y: number; width: number; height: number };
  /** Size of the image the bounds are measured in (ML Kit's input). */
  frameWidth?: number;
  frameHeight?: number;
}

export type PhotoIssue =
  | 'invalid_image'
  | 'image_unreadable'
  | 'detector_unavailable'
  | 'detector_defect'
  | 'detector_failed'
  | 'no_face'
  | 'several_faces'
  | 'off_frame'
  | 'too_small';

export type PhotoCheck = { ok: true } | { ok: false; issue: PhotoIssue; guidance: string; detail?: string };

/** Detector option: faces narrower than this share of the photo aren't reported at all (ML Kit's default). */
export const DETECTOR_MIN_FACE = 0.1;
/** The face must be at least this share of the photo's width… */
export const MIN_FACE_WIDTH_SHARE = 0.2;
/** …and this many pixels across: face-opensource crops 112x112 for the embedding. */
export const MIN_FACE_PIXELS = 160;

export function guidanceFor(issue: PhotoIssue, name = 'Their'): string {
  const who = name === 'Their' ? 'their' : `${name}'s`;
  const Who = name === 'Their' ? 'Their' : `${name}'s`;
  switch (issue) {
    case 'invalid_image':
      return "This photo couldn't be read. Please take another photo.";
    case 'image_unreadable':
      return "The photo couldn't be opened on this phone. Please take another photo.";
    case 'detector_unavailable':
      return "This version of the app can't check photos for a face on this phone. Update the app, then try again.";
    case 'detector_defect':
      return "This version of the app can't check the photo for a face. Update the app, then try again.";
    case 'detector_failed':
      return 'The face check on this phone stopped with an error. Please take another photo. If it happens again, close and reopen the app.';
    case 'no_face':
      return "We couldn't find a face. Please take another photo.";
    case 'several_faces':
      return 'Only one person should be visible in the photo.';
    case 'off_frame':
      return `Part of ${who} face is cut off. Center ${who} face in the circle.`;
    case 'too_small':
      return `${Who} face is too small in the photo. Move closer so it fills most of the circle.`;
  }
}

const fail = (issue: PhotoIssue, name?: string, detail?: string): PhotoCheck => ({
  ok: false,
  issue,
  guidance: guidanceFor(issue, name),
  ...(detail ? { detail } : {}),
});

/**
 * The verdict for the faces ML Kit found in a photo of `image` size. The
 * order matters: count first (a second face could be the guardian's, and the
 * server would enrol the largest), then whether the one face is fully in view
 * and big enough.
 */
export function checkPhotoFaces(
  faces: readonly DetectedFace[],
  image: { width: number; height: number },
  name?: string,
): PhotoCheck {
  const frame = (f: DetectedFace) => ({
    width: f.frameWidth && f.frameWidth > 0 ? f.frameWidth : image.width,
    height: f.frameHeight && f.frameHeight > 0 ? f.frameHeight : image.height,
  });
  const visible = faces.filter((f) => f.bounds.width >= DETECTOR_MIN_FACE * frame(f).width);
  if (visible.length === 0) return fail('no_face', name);
  if (visible.length > 1) return fail('several_faces', name);

  const face = visible[0];
  const { width, height } = frame(face);
  const { x, y, width: w, height: h } = face.bounds;
  if (x < 0 || y < 0 || x + w > width || y + h > height) return fail('off_frame', name);
  if (w < MIN_FACE_WIDTH_SHARE * width || w < MIN_FACE_PIXELS) return fail('too_small', name);
  return { ok: true };
}

/** The file itself couldn't be opened, rather than ML Kit failing on it:
 *  Android's IOException family, POSIX errors, and the iOS detector's own
 *  "Invalid image URI" / "Failed to load image …". */
const FILE_ERROR = /FileNotFound|IOException|No such file|ENOENT|EACCES|Permission denied|Invalid image URI|Failed to load image/i;
/** The detector library's still-photo defect, by its own messages (Android
 *  IllegalArgumentException, iOS NSError): its native code couldn't read the
 *  photo reference the bridge hands it, whatever the photo. */
const DETECTOR_DEFECT = /Invalid image type\. Expected string or \{ uri \}|Invalid image object: missing 'uri'/;
const MAX_DETAIL = 300;

/** Whether a detector error (as errorDetail logs it) is the library's known defect. */
export function isDetectorDefect(detail: string): boolean {
  return DETECTOR_DEFECT.test(detail);
}

/** An error as one log-safe line: its name and message, with file paths and URIs removed. */
export function errorDetail(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text
    .replace(/(?:file|content):\/\/\S+|\/(?:data|storage|var|private|Users)\/\S+/g, '<path>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DETAIL);
}

export interface PhotoCheckInput {
  /** Size of the prepared JPEG, as the image library reported it. */
  image: { width: number; height: number };
  /** Whether the prepared file is still on disk and not empty. */
  fileReadable: () => boolean;
  /** ML Kit's still-image detector run on that file, or the error that kept it from being created. */
  detector: { detectFaces: () => readonly DetectedFace[] } | { unavailable: unknown };
}

/** The whole local check, in order: image size, file, detector, faces. */
export function checkPhoto({ image, fileReadable, detector }: PhotoCheckInput, name?: string): PhotoCheck {
  const { width, height } = image;
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) {
    return fail('invalid_image', name, `image size ${width}x${height}`);
  }
  let readable: boolean;
  try {
    readable = fileReadable();
  } catch (err) {
    return fail('image_unreadable', name, errorDetail(err));
  }
  if (!readable) return fail('image_unreadable', name, 'prepared photo file is missing or empty');
  if ('unavailable' in detector) return fail('detector_unavailable', name, errorDetail(detector.unavailable));

  let faces: unknown;
  try {
    faces = detector.detectFaces();
  } catch (err) {
    const detail = errorDetail(err);
    if (isDetectorDefect(detail)) return fail('detector_defect', name, detail);
    return fail(FILE_ERROR.test(detail) ? 'image_unreadable' : 'detector_failed', name, detail);
  }
  if (!Array.isArray(faces)) {
    return fail('detector_failed', name, `detector returned ${faces === null ? 'null' : typeof faces}, not a list of faces`);
  }
  return checkPhotoFaces(faces, image, name);
}

/** Save is offered only for the photo under review whose own check passed.
 *  Retaking goes back to the camera, which drops that photo and its verdict. */
export function canSavePhoto(stage: { phase: string; check?: PhotoCheck }): boolean {
  return stage.phase === 'review' && stage.check?.ok === true;
}

/** A check this app can't run here at all: retaking can't help, updating can. */
export function needsAppUpdate(check: PhotoCheck): check is Extract<PhotoCheck, { ok: false }> {
  return !check.ok && (check.issue === 'detector_defect' || check.issue === 'detector_unavailable');
}

export interface PhotoLogContext {
  platform: string;
  image: { width: number; height: number };
  camera: 'front' | 'back';
  mode: 'enroll' | 'update';
}

/** One log line for a check: the result, and for a failure its category and
 *  technical reason, with what it ran on. Never the image or a file path. */
export function photoCheckLog(check: PhotoCheck, { platform, image, camera, mode }: PhotoLogContext): string {
  return [
    check.ok ? 'face=ok' : `face=failed category=${check.issue}`,
    ...(!check.ok && check.detail ? [`error="${check.detail.replace(/"/g, "'")}"`] : []),
    `platform=${platform}`,
    `image=${image.width}x${image.height}`,
    `camera=${camera}`,
    `mode=${mode}`,
  ].join(' ');
}
