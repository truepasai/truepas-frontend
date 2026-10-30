// One usable face in the prepared enrolment photo, judged on the still image.
// Run: npm test   (node --test; Node 22.6+ imports the .ts module directly)
// Inputs are synthetic detector results (boxes and angles) — no images.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MAX_YAW, MIN_FACE_PIXELS, checkPhoto, checkPhotoFaces, guidanceFor } from '../photoQuality.ts';

const IMAGE = { width: 1200, height: 1600 };
const face = (overrides = {}) => ({
  bounds: { x: 300, y: 400, width: 600, height: 700 },
  yawAngle: 2,
  pitchAngle: -3,
  rollAngle: 1,
  leftEyeOpenProbability: 0.9,
  rightEyeOpenProbability: 0.85,
  frameWidth: 1200,
  frameHeight: 1600,
  ...overrides,
});
const issue = (faces, image = IMAGE) => {
  const check = checkPhotoFaces(faces, image, 'Mia');
  return check.ok ? 'ok' : check.issue;
};

describe('checkPhotoFaces', () => {
  it('accepts one centred, frontal, open-eyed face that fills the circle', () => {
    assert.deepEqual(checkPhotoFaces([face()], IMAGE, 'Mia'), { ok: true });
  });

  it('needs a face', () => {
    assert.equal(issue([]), 'no_face');
    // Light and blur aren't measured by the detector, so they're only named as likely causes.
    assert.match(guidanceFor('no_face', 'Mia'), /good light.*steady/);
  });

  it('refuses a second face — it could be the parent holding the phone', () => {
    assert.equal(issue([face(), face({ bounds: { x: 20, y: 20, width: 250, height: 300 } })]), 'several_faces');
  });

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

  it('asks for a straight-on face', () => {
    assert.equal(issue([face({ rollAngle: 35 })]), 'rolled');
    assert.equal(issue([face({ yawAngle: MAX_YAW + 5 })]), 'turned');
    assert.equal(issue([face({ yawAngle: -(MAX_YAW + 5) })]), 'turned');
    assert.equal(issue([face({ pitchAngle: 28 })]), 'tilted');
  });

  it('asks again when both eyes are clearly closed, but not when the detector has no eye reading', () => {
    assert.equal(issue([face({ leftEyeOpenProbability: 0.05, rightEyeOpenProbability: 0.1 })]), 'eyes_closed');
    assert.equal(issue([face({ leftEyeOpenProbability: 0.05, rightEyeOpenProbability: 0.7 })]), 'ok');
    assert.equal(issue([face({ leftEyeOpenProbability: undefined, rightEyeOpenProbability: undefined })]), 'ok');
    assert.equal(issue([face({ leftEyeOpenProbability: -1, rightEyeOpenProbability: -1 })]), 'ok');
  });

  it('measures the face against the detector frame when it reports one', () => {
    const frame = { frameWidth: 600, frameHeight: 800 };
    assert.equal(issue([face({ bounds: { x: 150, y: 200, width: 300, height: 350 }, ...frame })]), 'ok');
  });

  it('gives guidance by name, never a technical reason', () => {
    const check = checkPhotoFaces([face({ bounds: { x: 500, y: 600, width: 200, height: 230 } })], IMAGE, 'Mia');
    assert.equal(check.ok, false);
    assert.match(check.guidance, /Mia's face is too small/);
  });
});

describe('checkPhoto', () => {
  it('a detector error gives no verdict, so the photo cannot be used', () => {
    const check = checkPhoto(() => {
      throw new Error('ML Kit not available');
    }, IMAGE, 'Mia');
    assert.equal(check.ok, false);
    assert.equal(check.issue, 'detector_error');
    assert.match(check.guidance, /couldn't check the photo/);
  });

  it('a detector returning something other than a list is an error too', () => {
    assert.equal(checkPhoto(() => null, IMAGE).issue, 'detector_error');
  });

  it('passes the detector result through the same rules', () => {
    assert.deepEqual(checkPhoto(() => [face()], IMAGE), { ok: true });
    assert.equal(checkPhoto(() => [], IMAGE).issue, 'no_face');
  });
});
