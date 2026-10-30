/**
 * Is there one usable face in the photo about to be enrolled? Checked on the
 * prepared JPEG itself — the exact image that is uploaded, not a preview
 * frame — with ML Kit's still-image face detector (the detector the liveness
 * camera uses on preview frames). These are capture-guidance limits on the
 * phone; the face service's own detection and every match threshold are
 * unchanged, and passing here does not guarantee the server finds the face.
 *
 * ML Kit reports each face's box, head angles and eye-open odds. It reports
 * nothing about light or blur, so those are only named as likely causes when
 * no face is found — never claimed as measured.
 *
 * Pure, so it runs under `node --test` (__tests__/photoQuality.test.mjs).
 */

export interface DetectedFace {
  bounds: { x: number; y: number; width: number; height: number };
  yawAngle: number;
  pitchAngle: number;
  rollAngle: number;
  leftEyeOpenProbability?: number;
  rightEyeOpenProbability?: number;
  /** Size of the image the bounds are measured in (ML Kit's input). */
  frameWidth?: number;
  frameHeight?: number;
}

export type PhotoIssue =
  | 'no_face'
  | 'several_faces'
  | 'off_frame'
  | 'too_small'
  | 'rolled'
  | 'turned'
  | 'tilted'
  | 'eyes_closed'
  | 'detector_error';

export type PhotoCheck = { ok: true } | { ok: false; issue: PhotoIssue; guidance: string };

/** Detector option: faces narrower than this share of the photo aren't reported at all. */
export const DETECTOR_MIN_FACE = 0.1;
/** The face must be at least this share of the photo's width… */
export const MIN_FACE_WIDTH_SHARE = 0.2;
/** …and this many pixels across: face-opensource crops 112x112 for the embedding. */
export const MIN_FACE_PIXELS = 160;
/** Head angles, in degrees, beyond which the photo is retaken. */
export const MAX_YAW = 20;
export const MAX_PITCH = 20;
export const MAX_ROLL = 20;
/** Both eyes below this open-probability count as closed. */
export const EYES_CLOSED_BELOW = 0.2;

export function guidanceFor(issue: PhotoIssue, name = 'Their'): string {
  const who = name === 'Their' ? 'their' : `${name}'s`;
  const Who = name === 'Their' ? 'Their' : `${name}'s`;
  switch (issue) {
    case 'no_face':
      return `We couldn't find a face in this photo. Use good light, hold the phone steady and get ${who} whole face inside the circle.`;
    case 'several_faces':
      return `More than one face is in the photo. Take it again with only ${who} face in view.`;
    case 'off_frame':
      return `Part of ${who} face is cut off. Center ${who} face in the circle.`;
    case 'too_small':
      return `${Who} face is too small in the photo. Move closer so it fills most of the circle.`;
    case 'rolled':
      return `The photo is at an angle. Hold the phone upright with ${who} head straight.`;
    case 'turned':
      return `The face is turned to the side. Take it when they look straight at the camera.`;
    case 'tilted':
      return `The head is tilted up or down. Take it with ${who} face level with the camera.`;
    case 'eyes_closed':
      return `${Who} eyes look closed. Take it again when they're open.`;
    case 'detector_error':
      return "This phone couldn't check the photo, so it can't be used yet. Take it again; if this keeps happening, update the app.";
  }
}

const fail = (issue: PhotoIssue, name?: string): PhotoCheck => ({ ok: false, issue, guidance: guidanceFor(issue, name) });

/**
 * The verdict for the faces ML Kit found in a photo of `image` size. The
 * order matters: count first (a second face could be the guardian's, and the
 * server would enrol the largest), then framing, size and angles.
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
  if (Math.abs(face.rollAngle) > MAX_ROLL) return fail('rolled', name);
  if (Math.abs(face.yawAngle) > MAX_YAW) return fail('turned', name);
  if (Math.abs(face.pitchAngle) > MAX_PITCH) return fail('tilted', name);
  const left = face.leftEyeOpenProbability;
  const right = face.rightEyeOpenProbability;
  if (left != null && right != null && left >= 0 && right >= 0 && left < EYES_CLOSED_BELOW && right < EYES_CLOSED_BELOW) {
    return fail('eyes_closed', name);
  }
  return { ok: true };
}

/** Run the detector on the photo; a detector that throws gives no verdict, so the photo can't be used. */
export function checkPhoto(
  detect: () => readonly DetectedFace[],
  image: { width: number; height: number },
  name?: string,
): PhotoCheck {
  let faces: readonly DetectedFace[];
  try {
    faces = detect();
  } catch {
    return fail('detector_error', name);
  }
  if (!Array.isArray(faces)) return fail('detector_error', name);
  return checkPhotoFaces(faces, image, name);
}
