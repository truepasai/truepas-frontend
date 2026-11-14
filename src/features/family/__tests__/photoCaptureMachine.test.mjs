// The live part of a member-under-5 photo: guidance, the 700 ms hold, and the
// one capture that automatic and manual capture share.
// Run: npm test   (node --test; Node 22.6+ imports the .ts modules directly)
// Inputs are synthetic detector frames (face boxes) — no images.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CAPTURE_RULES, HOLD_MS, createStableFaceCapture } from '../../liveness/faceCapture.ts';
import {
  UNDER5_HOLD_MS,
  UNDER5_RULES,
  createPhotoCaptureMachine,
  liveGuidance,
  liveMessage,
  photoScreenState,
  toFaceSample,
} from '../photoCaptureMachine.ts';

// A portrait frame with one suitable face: 40% of the width, centered, facing the camera.
const FRAME = { frameWidth: 720, frameHeight: 1280 };
const face = (overrides = {}) => ({
  bounds: { x: 216, y: 440, width: 288, height: 360 },
  ...FRAME,
  yaw: 0,
  pitch: 0,
  roll: 0,
  leftEyeOpen: 0.9,
  rightEyeOpen: 0.9,
  ...overrides,
});
const moved = (dx) => face({ bounds: { x: 216 + dx, y: 440, width: 288, height: 360 } });
const machine = () => createPhotoCaptureMachine(createStableFaceCapture);
/** Frames every 100 ms from `from` to `to` (inclusive); the last result. */
const feed = (m, faces, from, to) => {
  let last;
  for (let t = from; t <= to; t += 100) last = m.frames(faces, t);
  return last;
};

describe('the limits and the hold for a member under 5', () => {
  it('holds still for 700 ms (approved), not the 5+ second', () => {
    assert.equal(UNDER5_HOLD_MS, 700);
    assert.equal(HOLD_MS, 1000);
  });

  it('uses the provisional under-5 limits', () => {
    assert.deepEqual(UNDER5_RULES, {
      minWidthShare: 0.22,
      maxWidthShare: 0.9,
      maxCenterOffsetX: 0.22,
      maxCenterOffsetY: 0.25,
      maxYaw: 20,
      maxPitch: 20,
      maxRoll: 25,
      minEyeOpen: 0.3,
      maxShift: 0.2,
      maxSizeChange: 0.2,
      maxYawChange: 10,
      maxGapMs: 500,
    });
  });

  it('leaves the 5+ limits as they were', () => {
    assert.deepEqual(CAPTURE_RULES.child, {
      minWidthShare: 0.22, maxWidthShare: 0.9, maxCenterOffsetX: 0.2, maxCenterOffsetY: 0.22,
      maxYaw: 18, maxPitch: 20, maxRoll: 20, minEyeOpen: 0.3,
      maxShift: 0.18, maxSizeChange: 0.2, maxYawChange: 10, maxGapMs: 500,
    });
    assert.equal(CAPTURE_RULES.self.minWidthShare, 0.25);
    assert.equal(CAPTURE_RULES.self.maxYaw, 12);
  });

  it('a toddler head angle the 5–9 limits refuse is fine here', () => {
    const m = machine();
    assert.equal(m.frames([face({ yaw: 19, roll: 22 })], 0).view.status, 'holding');
  });
});

describe('camera start and guidance', () => {
  it('starts as initializing, until the camera starts or a first frame arrives', () => {
    const m = machine();
    assert.deepEqual(m.view(), { status: 'initializing' });
    assert.equal(liveMessage(m.view()), 'Starting the camera…');
    assert.deepEqual(m.cameraStarted(), { status: 'looking' });
    const n = machine();
    assert.equal(n.frames([], 0).view.status, 'looking');
  });

  it('no face: looking, with the adult told where to point', () => {
    const m = machine();
    const { view, capture } = m.frames([], 0);
    assert.deepEqual(view, { status: 'looking' });
    assert.equal(capture, false);
    assert.equal(liveMessage(view, 'Mia'), "Point the camera at Mia's face.");
    assert.equal(liveMessage(view), 'Point the camera at their face.');
  });

  it('two faces: adjust, never a capture (the second could be the adult holding the phone)', () => {
    const m = machine();
    const last = feed(m, [face(), face({ bounds: { x: 20, y: 20, width: 200, height: 250 } })], 0, 3000);
    assert.deepEqual(last, { view: { status: 'adjusting', problem: 'several_faces' }, capture: false });
    assert.equal(liveMessage(last.view, 'Mia'), 'Only Mia should be in the frame.');
    assert.equal(m.canTakePhoto(3000), false);
    assert.equal(m.begin('manual', 3000), false);
    assert.equal(m.begin('auto', 3000), false);
  });

  it('each other problem has its own guidance for the adult', () => {
    const cases = [
      [face({ bounds: { x: 300, y: 560, width: 120, height: 150 } }), 'too_far', 'Move the phone a little closer.'],
      [face({ bounds: { x: 20, y: 200, width: 690, height: 800 } }), 'too_close', 'Move the phone a little further away.'],
      [face({ bounds: { x: 560, y: 440, width: 288, height: 360 } }), 'cut_off', 'Keep their whole face inside the circle.'],
      [face({ bounds: { x: 40, y: 440, width: 288, height: 360 } }), 'not_centered', 'Center their face in the circle.'],
      [face({ yaw: 35 }), 'turned', 'Wait until they look at the camera.'],
      [face({ leftEyeOpen: 0.1 }), 'eyes_closed', 'Wait until their eyes are open.'],
    ];
    for (const [sample, problem, text] of cases) {
      const { view } = machine().frames([sample], 0);
      assert.deepEqual(view, { status: 'adjusting', problem }, problem);
      assert.equal(liveMessage(view), text, problem);
    }
  });

  it('a suitable face: Face found, hold still — and a tip once it takes long', () => {
    const { view } = machine().frames([face()], 0);
    assert.equal(view.status, 'holding');
    assert.equal(liveMessage(view), 'Face found. Hold still…');
    assert.match(liveGuidance(false), /taken when their face is steady, or tap Take photo/);
    assert.match(liveGuidance(true), /brighter spot/);
  });
});

describe('automatic capture', () => {
  it('fires once, after the face holds still for 700 ms', () => {
    const m = machine();
    const at600 = feed(m, [face()], 0, 600);
    assert.equal(at600.capture, false);
    assert.equal(at600.view.status, 'holding');
    assert.ok(Math.abs(at600.view.progress - 600 / 700) < 1e-9);
    const at700 = m.frames([face()], 700);
    assert.equal(at700.capture, true);
    assert.equal(m.begin('auto', 700), true);
    // Claimed: further frames take nothing and change nothing.
    assert.equal(feed(m, [face()], 800, 3000).capture, false);
    assert.equal(m.begin('auto', 3000), false);
  });

  it('is never claimed without a completed hold', () => {
    const m = machine();
    feed(m, [face()], 0, 500);
    assert.equal(m.begin('auto', 500), false);
  });

  it('movement during the hold starts it again from zero', () => {
    const m = machine();
    feed(m, [face()], 0, 500);
    // More than 20% of the face's width away from where the hold began.
    assert.deepEqual(m.frames([moved(80)], 600).view, { status: 'holding', progress: 0 });
    assert.equal(feed(m, [moved(80)], 700, 1200).capture, false);
    assert.equal(m.frames([moved(80)], 1300).capture, true);
  });

  it('small movement within the limit does not', () => {
    const m = machine();
    feed(m, [face()], 0, 600);
    assert.equal(m.frames([moved(30)], 700).capture, true);
  });

  it('the face leaving the frame cancels the hold', () => {
    const m = machine();
    feed(m, [face()], 0, 500);
    assert.equal(m.frames([], 600).view.status, 'looking');
    assert.equal(feed(m, [face()], 700, 1300).capture, false);
    assert.equal(m.frames([face()], 1400).capture, true);
  });

  it('a gap between frames cancels the hold, and the screen stops showing it', () => {
    const m = machine();
    feed(m, [face()], 0, 300);
    assert.equal(m.tick(900).status, 'looking');
    assert.equal(m.canTakePhoto(900), false);
    assert.deepEqual(m.frames([face()], 900).view, { status: 'holding', progress: 0 });
  });
});

describe('manual capture (Take photo)', () => {
  it('is enabled only while exactly one suitable face is in view', () => {
    const m = machine();
    assert.equal(m.canTakePhoto(0), false);
    m.frames([], 0);
    assert.equal(m.canTakePhoto(0), false);
    m.frames([face({ yaw: 40 })], 100);
    assert.equal(m.canTakePhoto(100), false);
    m.frames([face()], 200);
    assert.equal(m.canTakePhoto(200), true);
    // Stale: no frame for longer than the gap allowed.
    assert.equal(m.canTakePhoto(800), false);
  });

  it('takes the photo before the hold completes, and only once', () => {
    const m = machine();
    feed(m, [face()], 0, 300);
    assert.equal(m.begin('manual', 300), true);
    assert.equal(m.canTakePhoto(300), false);
    assert.equal(m.begin('manual', 300), false);
    // The hold would have completed meanwhile (at 700 ms): no frame asks for
    // a second photo, and the view stays as it was claimed.
    const claimedView = m.view();
    for (let t = 400; t <= 1500; t += 100) {
      assert.deepEqual(m.frames([face()], t), { view: claimedView, capture: false }, `${t} ms`);
    }
    assert.equal(m.begin('auto', 1500), false);
  });

  it('cannot start while an automatic capture runs', () => {
    const m = machine();
    feed(m, [face()], 0, 700);
    assert.equal(m.begin('auto', 700), true);
    assert.equal(m.begin('manual', 700), false);
  });
});

describe('retake resets capture and stability', () => {
  it('a retake drops the claim and needs a full new hold', () => {
    const m = machine();
    feed(m, [face()], 0, 700);
    assert.equal(m.begin('auto', 700), true);
    assert.deepEqual(m.reset(5000), { status: 'initializing' });
    assert.equal(m.canTakePhoto(5000), false);
    assert.equal(m.frames([face()], 5000).capture, false);
    assert.equal(feed(m, [face()], 5100, 5600).capture, false);
    assert.equal(m.frames([face()], 5700).capture, true);
    assert.equal(m.begin('auto', 5700), true);
  });

  it('a retake right after a manual capture works the same way', () => {
    const m = machine();
    m.frames([face()], 0);
    assert.equal(m.begin('manual', 0), true);
    m.reset(100);
    m.frames([face()], 200);
    assert.equal(m.begin('manual', 200), true);
  });
});

describe('screen states', () => {
  it('names every state the photo screen shows', () => {
    assert.equal(photoScreenState('camera', { status: 'initializing' }), 'initializing');
    assert.equal(photoScreenState('camera', { status: 'looking' }), 'looking');
    assert.equal(photoScreenState('camera', { status: 'adjusting', problem: 'too_far' }), 'adjusting');
    assert.equal(photoScreenState('camera', { status: 'holding', progress: 0.5 }), 'holding');
    const live = { status: 'holding', progress: 1 };
    assert.equal(photoScreenState('capturing', live), 'capturing');
    assert.equal(photoScreenState('checking', live), 'checking');
    assert.equal(photoScreenState('review', live), 'preview');
    for (const phase of ['sending', 'confirming', 'unknown']) assert.equal(photoScreenState(phase, live), 'saving', phase);
    assert.equal(photoScreenState('done', live), 'saved');
    assert.equal(photoScreenState('failed', live), 'failed');
  });
});

describe('detector faces', () => {
  it('become plain samples with the fields the hold reads', () => {
    const sample = toFaceSample({
      bounds: { x: 1, y: 2, width: 3, height: 4 },
      frameWidth: 720,
      frameHeight: 1280,
      yawAngle: 5,
      pitchAngle: 6,
      rollAngle: 7,
      leftEyeOpenProbability: 0.8,
      rightEyeOpenProbability: undefined,
      smilingProbability: 1,
    });
    assert.deepEqual(sample, {
      bounds: { x: 1, y: 2, width: 3, height: 4 },
      frameWidth: 720,
      frameHeight: 1280,
      yaw: 5,
      pitch: 6,
      roll: 7,
      leftEyeOpen: 0.8,
      rightEyeOpen: undefined,
    });
  });
});
