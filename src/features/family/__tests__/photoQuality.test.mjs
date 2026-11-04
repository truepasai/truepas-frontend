// The under-5 photo check: exactly one clearly visible face in the prepared
// enrolment photo, judged on the phone — no liveness and no face match.
// Run: npm test   (node --test; Node 22.6+ imports the .ts module directly)
// Inputs are synthetic detector results (face boxes) — no images.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { memberCaptureMode } from '../memberSetupState.ts';
import {
  MIN_FACE_PIXELS,
  canSavePhoto,
  checkPhoto,
  checkPhotoFaces,
  errorDetail,
  guidanceFor,
  photoCheckLog,
} from '../photoQuality.ts';

const IMAGE = { width: 1200, height: 1600 };
const face = (overrides = {}) => ({
  bounds: { x: 300, y: 400, width: 600, height: 700 },
  frameWidth: 1200,
  frameHeight: 1600,
  ...overrides,
});
const issue = (faces, image = IMAGE) => {
  const check = checkPhotoFaces(faces, image, 'Mia');
  return check.ok ? 'ok' : check.issue;
};
/** The screen's whole check: a readable file and a detector returning `faces`. */
const run = (faces, { image = IMAGE, fileReadable = () => true } = {}) =>
  checkPhoto({ image, fileReadable, detector: { detectFaces: () => faces } }, 'Mia');
const throwing = (err) => checkPhoto({ image: IMAGE, fileReadable: () => true, detector: { detectFaces: () => { throw err; } } }, 'Mia');
/** Save as the screen decides it: the photo under review and its own check. */
const saveAfter = (check) => canSavePhoto({ phase: 'review', check });

describe('photo enrolment for a member under 5', () => {
  it('age 2, exactly one face: Save is enabled', () => {
    assert.equal(memberCaptureMode({ age: 2 }), 'photo');
    const check = run([face()]);
    assert.deepEqual(check, { ok: true });
    assert.equal(saveAfter(check), true);
  });

  it("age 2, no face: Save stays disabled, with the retake message", () => {
    const check = run([]);
    assert.equal(check.issue, 'no_face');
    assert.equal(check.guidance, "We couldn't find a face. Please take another photo.");
    assert.equal(saveAfter(check), false);
  });

  it('age 2, two faces: Save stays disabled — it could be the parent holding the phone', () => {
    const check = run([face(), face({ bounds: { x: 20, y: 20, width: 250, height: 300 } })]);
    assert.equal(check.issue, 'several_faces');
    assert.equal(check.guidance, 'Only one person should be visible in the photo.');
    assert.equal(saveAfter(check), false);
  });

  it('age 4, exactly one face: Save is enabled', () => {
    assert.equal(memberCaptureMode({ age: 4 }), 'photo');
    assert.equal(saveAfter(run([face()])), true);
  });

  it('ages 5, 9 and 10 are not checked here: they keep the liveness capture', () => {
    for (const age of [5, 9, 10]) {
      assert.equal(memberCaptureMode({ age }), 'liveness');
      assert.equal(memberCaptureMode({ age, faceCaptureMode: 'liveness' }), 'liveness');
    }
  });

  it('retaking clears the earlier verdict: back at the camera, nothing can be saved', () => {
    assert.equal(saveAfter(run([face()])), true);
    assert.equal(canSavePhoto({ phase: 'camera' }), false);
    assert.equal(canSavePhoto({ phase: 'preparing' }), false);
  });
});

describe('the face must be fully in view and large enough', () => {
  it('ignores a face too small for the detector to report as a person in the photo', () => {
    assert.equal(issue([face(), face({ bounds: { x: 0, y: 0, width: 60, height: 70 } })]), 'ok');
  });

  it('asks to center a face that runs off the edge', () => {
    assert.equal(issue([face({ bounds: { x: 900, y: 400, width: 400, height: 500 } })]), 'off_frame');
    assert.equal(issue([face({ bounds: { x: 300, y: -40, width: 600, height: 700 } })]), 'off_frame');
  });

  it('asks to move closer when the face is too small', () => {
    assert.equal(issue([face({ bounds: { x: 500, y: 600, width: 200, height: 230 } })]), 'too_small');
    // Wide enough a share, but too few pixels for the server's 112 px crop to work from.
    const small = { width: 600, height: 800 };
    assert.equal(issue([face({ bounds: { x: 200, y: 300, width: MIN_FACE_PIXELS - 10, height: 180 }, frameWidth: 600, frameHeight: 800 })], small), 'too_small');
  });

  it('measures the face against the detector frame when it reports one', () => {
    const frame = { frameWidth: 600, frameHeight: 800 };
    assert.equal(issue([face({ bounds: { x: 150, y: 200, width: 300, height: 350 }, ...frame })]), 'ok');
  });

  it('accepts any head angle or eye state: only face presence is judged', () => {
    assert.equal(issue([face({ yawAngle: 40, rollAngle: 35, leftEyeOpenProbability: 0, rightEyeOpenProbability: 0 })]), 'ok');
  });

  it('gives guidance by name, never a technical reason', () => {
    const check = checkPhotoFaces([face({ bounds: { x: 500, y: 600, width: 200, height: 230 } })], IMAGE, 'Mia');
    assert.match(check.guidance, /Mia's face is too small/);
  });
});

describe('an unusable image or a detector failure keeps Save disabled and says which', () => {
  it('an image without a usable size is invalid, before the detector runs', () => {
    let ran = false;
    const check = checkPhoto({ image: { width: 0, height: 1600 }, fileReadable: () => true, detector: { detectFaces: () => { ran = true; return [face()]; } } });
    assert.equal(check.issue, 'invalid_image');
    assert.equal(ran, false);
    assert.equal(saveAfter(check), false);
    assert.equal(run([face()], { image: { width: Number.NaN, height: 10 } }).issue, 'invalid_image');
  });

  it('a prepared file that is gone or empty is unreadable', () => {
    const check = run([face()], { fileReadable: () => false });
    assert.equal(check.issue, 'image_unreadable');
    assert.match(check.guidance, /couldn't be opened on this phone/);
    assert.equal(saveAfter(check), false);
    const thrown = run([face()], { fileReadable: () => { throw new Error('ENOENT: no such file'); } });
    assert.equal(thrown.issue, 'image_unreadable');
    assert.match(thrown.detail, /ENOENT/);
  });

  it('a detector that could not be created is an initialization failure', () => {
    const check = checkPhoto({ image: IMAGE, fileReadable: () => true, detector: { unavailable: new Error('HybridObject "ImageFaceDetectorFactory" not found') } });
    assert.equal(check.issue, 'detector_unavailable');
    assert.match(check.guidance, /Update the app/);
    assert.match(check.detail, /ImageFaceDetectorFactory/);
    assert.equal(saveAfter(check), false);
  });

  it('ML Kit failing while it runs is an execution failure, with an action and its reason', () => {
    const check = throwing(new Error('com.google.mlkit.common.MlKitException: Failed to run face detector'));
    assert.equal(check.issue, 'detector_failed');
    assert.match(check.guidance, /take another photo/i);
    assert.match(check.guidance, /close and reopen the app/);
    assert.match(check.detail, /MlKitException/);
    assert.equal(saveAfter(check), false);
  });

  it('a file error from inside the detector is reported as the file, not ML Kit', () => {
    const android = throwing(new Error('java.io.FileNotFoundException: /data/user/0/com.facepeai.truepas/cache/ImageManipulator/a.jpg (No such file or directory)'));
    assert.equal(android.issue, 'image_unreadable');
    assert.equal(throwing(new Error('Failed to load image from file')).issue, 'image_unreadable');
    assert.equal(throwing(new Error('Invalid image URI')).issue, 'image_unreadable');
  });

  it('a detector returning something other than a list is an execution failure', () => {
    const check = checkPhoto({ image: IMAGE, fileReadable: () => true, detector: { detectFaces: () => null } });
    assert.equal(check.issue, 'detector_failed');
    assert.match(check.detail, /null/);
  });

  it('every failure message is actionable, and none is the old generic one', () => {
    for (const code of ['invalid_image', 'image_unreadable', 'detector_unavailable', 'detector_failed', 'no_face', 'several_faces', 'off_frame', 'too_small']) {
      const text = guidanceFor(code, 'Mia');
      assert.ok(text.length > 20, code);
      assert.doesNotMatch(text, /couldn't check the photo/, code);
    }
  });
});

describe('diagnostics', () => {
  it("keep the error's class and message but no file path or URI", () => {
    const detail = errorDetail(new Error('java.io.FileNotFoundException: /data/user/0/com.facepeai.truepas/cache/x.jpg (No such file)'));
    assert.match(detail, /^Error: java\.io\.FileNotFoundException: <path>/);
    assert.doesNotMatch(detail, /facepeai|x\.jpg/);
    assert.doesNotMatch(errorDetail(new Error('bad file:///var/mobile/Containers/a.jpg')), /var\/mobile|a\.jpg/);
    assert.equal(errorDetail('x'.repeat(500)).length, 300);
  });

  it('a log line has the category, error, platform, image size and capture mode', () => {
    const check = throwing(new Error('MlKitException: internal error'));
    const line = photoCheckLog(check, { platform: 'android 34', image: IMAGE, camera: 'back', mode: 'enroll' });
    assert.equal(line, 'face=failed category=detector_failed error="Error: MlKitException: internal error" platform=android 34 image=1200x1600 camera=back mode=enroll');
    assert.equal(
      photoCheckLog({ ok: true }, { platform: 'ios 18.2', image: IMAGE, camera: 'front', mode: 'update' }),
      'face=ok platform=ios 18.2 image=1200x1600 camera=front mode=update',
    );
  });
});

describe('the photo screen (source guard — screens cannot render under node --test)', () => {
  const camera = readFileSync(new URL('../../../premium/flows/familyPhotoCapture.tsx', import.meta.url), 'utf8');
  const quality = readFileSync(new URL('../photoQuality.ts', import.meta.url), 'utf8');
  // Code only: comments may name what the screen deliberately doesn't use.
  const cameraCode = camera.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('never starts liveness or a face match', () => {
    assert.doesNotMatch(cameraCode, /LivenessCamera|livenessSessionId|startLiveness|liveness\/v2|faces\/verify|faceLogin/);
  });

  it('sends the checked photo through the existing enrolment and update calls only', () => {
    assert.match(camera, /enrollFace\.mutateAsync\(\{ selfieBase64: photo\.base64, personId, enrollmentRef: ref, requestId \}\)/);
    assert.match(camera, /updateFace\.mutateAsync\(\{ personId, selfieBase64: photo\.base64 \}\)/);
  });

  it('gates Save on this photo passing, and creates the detector where a failure is caught', () => {
    assert.match(camera, /disabled=\{!canSavePhoto\(stage\)\}/);
    assert.match(camera, /if \(stage\.phase !== 'review' \|\| !canSavePhoto\(stage\) \|\| !personId\) return;/);
    assert.doesNotMatch(cameraCode, /useImageFaceDetector/);
    assert.match(camera, /createImageFaceDetector\(DETECTOR_OPTIONS\)/);
    assert.match(camera, /Make sure the child's face is clearly visible\./);
  });

  it('logs a failed check with its reason, and swallows no detector error', () => {
    assert.match(camera, /console\.warn\('\[FaceCapture\] photo', photo\.label, line\)/);
    assert.doesNotMatch(quality, /catch\s*\{|catch\s*\([^)]*\)\s*\{\s*\}/);
  });
});
