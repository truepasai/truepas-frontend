// The face photo before Regula liveness: a suitable face must hold still for
// a full second, and the photo is taken once.
// Run: npm test   (node --test; Node 22.6+ imports the .ts module directly)
// Inputs are synthetic detector faces — no images.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CAPTURE_COPY,
  CAPTURE_RULES,
  CAPTURE_TIP_AFTER_MS,
  CHILD_UNDER_AGE,
  HOLD_MS,
  captureGuidance,
  captureMessage,
  captureSubject,
  createStableFaceCapture,
  faceProblem,
  facingCamera,
  movedSince,
  problemMessage,
} from '../faceCapture.ts';
import { memberCaptureMode } from '../../family/memberSetupState.ts';

const FRAME = { frameWidth: 480, frameHeight: 640 };
const ADULT = CAPTURE_RULES.self;
const CHILD = CAPTURE_RULES.child;

/** A face of `width` px centered at (cx, cy) in a 480x640 portrait frame. */
function face({ cx = 240, cy = 320, width = 200, yaw = 0, pitch = 0, roll = 0, eyes = 0.95, ...rest } = {}) {
  const height = width * 1.2;
  return {
    bounds: { x: cx - width / 2, y: cy - height / 2, width, height },
    ...FRAME,
    yaw,
    pitch,
    roll,
    leftEyeOpen: eyes,
    rightEyeOpen: eyes,
    ...rest,
  };
}

/** Feed `frames` (one list of faces each) every `stepMs`, from t=0. */
function feed(machine, frames, stepMs = 100, start = 0) {
  return frames.map((faces, i) => machine.update(faces, start + i * stepMs));
}
const still = (n, f = face()) => Array.from({ length: n }, () => [f]);

describe('face detection and positioning', () => {
  it('one centered, frontal face with open eyes is suitable', () => {
    assert.equal(faceProblem([face()], ADULT), null);
  });

  for (const [label, faces, problem] of [
    ['no face', [], 'no_face'],
    ['two faces', [face({ cx: 150 }), face({ cx: 330 })], 'several_faces'],
    ['a face cut off by the frame edge', [face({ cx: 40 })], 'cut_off'],
    ['a face too far away', [face({ width: 90 })], 'too_far'],
    ['a face too close', [face({ width: 440 })], 'too_close'],
    ['a face off to one side', [face({ cx: 330 })], 'not_centered'],
    ['a face too high', [face({ cy: 170 })], 'not_centered'],
    ['a head turned to the side', [face({ yaw: 25 })], 'turned'],
    ['a head tilted down', [face({ pitch: -22 })], 'turned'],
    ['a tilted head', [face({ roll: 20 })], 'turned'],
    ['closed eyes', [face({ eyes: 0.1 })], 'eyes_closed'],
  ]) {
    it(`${label}: ${problem}`, () => {
      assert.equal(faceProblem(faces, ADULT), problem);
    });
  }

  it('without the frame size, position and size are not judged (angles and eyes still are)', () => {
    const unsized = { ...face({ cx: 40, width: 50 }), frameWidth: 0, frameHeight: 0 };
    assert.equal(faceProblem([unsized], ADULT), null);
    assert.equal(faceProblem([{ ...unsized, yaw: 30 }], ADULT), 'turned');
  });

  it('a missing eye or angle reading is not held against the face', () => {
    assert.equal(faceProblem([face({ eyes: undefined, yaw: undefined })], ADULT), null);
  });

  it('facing the camera means every head angle within the limits', () => {
    assert.equal(facingCamera({ yaw: 11, pitch: -14, roll: 14 }, ADULT), true);
    assert.equal(facingCamera({ yaw: 13 }, ADULT), false);
  });
});

describe('a child: wider limits for a smaller face that moves more', () => {
  it('a smaller, less centered, more turned face passes for a child but not an adult', () => {
    const small = face({ width: 110, cx: 300, yaw: 15, eyes: 0.4 });
    assert.notEqual(faceProblem([small], ADULT), null);
    assert.equal(faceProblem([small], CHILD), null);
  });

  it('a child face still has to be large enough for the photo check (20% of the width)', () => {
    assert.ok(CHILD.minWidthShare >= 0.2);
    assert.equal(faceProblem([face({ width: 90 })], CHILD), 'too_far');
  });

  it('a child still has to be the only face in view', () => {
    assert.equal(faceProblem([face({ cx: 150, width: 120 }), face({ cx: 330, width: 120 })], CHILD), 'several_faces');
  });
});

describe('who is in front of the camera', () => {
  it('your own face (onboarding enrollment, Update face): self', () => {
    assert.equal(captureSubject(undefined, undefined), 'self');
    assert.equal(captureSubject(undefined, 7), 'self');
  });

  it(`a member under ${CHILD_UNDER_AGE}: child; older or age unknown: member`, () => {
    assert.equal(captureSubject('p1', 5), 'child');
    assert.equal(captureSubject('p1', 9), 'child');
    assert.equal(captureSubject('p1', 10), 'member');
    assert.equal(captureSubject('p1', 40), 'member');
    assert.equal(captureSubject('p1', undefined), 'member');
    assert.equal(captureSubject('p1', Number.NaN), 'member');
  });

  it('a member under 5 never reaches liveness: their capture is a photo', () => {
    for (const age of [0, 1, 4]) assert.equal(memberCaptureMode(null, age), 'photo');
    for (const age of [5, 9, 30]) assert.equal(memberCaptureMode(null, age), 'liveness');
    // The server's own rule wins when it sends one.
    assert.equal(memberCaptureMode({ faceCaptureMode: 'photo', age: 7 }), 'photo');
  });
});

describe('the one-second stable-face countdown', () => {
  it('does not capture as soon as a face appears', () => {
    const machine = createStableFaceCapture(ADULT);
    assert.deepEqual(machine.update([face()], 0), { status: 'holding', progress: 0 });
  });

  it(`captures after the face holds still for ${HOLD_MS} ms, not before`, () => {
    const machine = createStableFaceCapture(ADULT);
    const states = feed(machine, still(11));
    assert.ok(states.slice(0, 10).every((s) => s.status === 'holding'));
    assert.ok(states[5].progress > 0.4 && states[5].progress < 0.6);
    assert.deepEqual(states[10], { status: 'capture' });
  });

  it('the countdown starts only once the face is suitable, not when it is first seen', () => {
    const machine = createStableFaceCapture(ADULT);
    // 0.5 s too far away, then suitable: the second still counts from 500 ms.
    const states = feed(machine, [...still(5, face({ width: 90 })), ...still(11)]);
    assert.ok(states.slice(0, 5).every((s) => s.status === 'adjusting' && s.problem === 'too_far'));
    assert.equal(states[14].status, 'holding');
    assert.equal(states[15].status, 'capture');
  });

  it('a face that moves during the countdown restarts it', () => {
    const machine = createStableFaceCapture(ADULT);
    const states = feed(machine, [...still(6), [face({ cx: 280 })], ...still(9, face({ cx: 280 }))]);
    // The jump at 600 ms starts a new hold there, so 900 ms later it is still counting.
    assert.deepEqual(states[6], { status: 'holding', progress: 0 });
    assert.ok(states.every((s) => s.status !== 'capture'));
    assert.equal(machine.update([face({ cx: 280 })], 1600).status, 'capture');
  });

  it('turning the head during the countdown restarts it, even within the limits', () => {
    const anchor = face({ yaw: -5 });
    assert.equal(movedSince(anchor, face({ yaw: 5 }), ADULT), true);
    assert.equal(movedSince(anchor, face({ yaw: -3 }), ADULT), false);
  });

  it('moving closer during the countdown restarts it', () => {
    assert.equal(movedSince(face({ width: 200 }), face({ width: 240 }), ADULT), true);
  });

  it('a face that disappears during the countdown cancels it', () => {
    const machine = createStableFaceCapture(ADULT);
    const states = feed(machine, [...still(7), [], ...still(10)]);
    assert.deepEqual(states[7], { status: 'searching' });
    assert.deepEqual(states[8], { status: 'holding', progress: 0 });
    assert.ok(states.every((s) => s.status !== 'capture'));
  });

  it('a face that becomes unsuitable during the countdown cancels it', () => {
    const machine = createStableFaceCapture(ADULT);
    const states = feed(machine, [...still(7), [face({ eyes: 0.05 })], [face(), face({ cx: 100 })], ...still(3)]);
    assert.deepEqual(states[7], { status: 'adjusting', problem: 'eyes_closed' });
    assert.deepEqual(states[8], { status: 'adjusting', problem: 'several_faces' });
    assert.deepEqual(states[9], { status: 'holding', progress: 0 });
  });

  it('a gap between frames restarts the countdown: stillness was not seen', () => {
    const machine = createStableFaceCapture(ADULT);
    machine.update([face()], 0);
    machine.update([face()], 300);
    assert.deepEqual(machine.update([face()], 300 + ADULT.maxGapMs + 1), { status: 'holding', progress: 0 });
  });

  it('small detector jitter does not restart it', () => {
    const machine = createStableFaceCapture(ADULT);
    const frames = Array.from({ length: 11 }, (_, i) => [face({ cx: 240 + (i % 2 ? 4 : -4), width: 200 + (i % 3) })]);
    assert.equal(feed(machine, frames).at(-1).status, 'capture');
  });
});

describe('one photo per hold', () => {
  it('after the capture, further frames never ask for a second photo', () => {
    const machine = createStableFaceCapture(ADULT);
    const states = feed(machine, still(30));
    assert.equal(states.filter((s) => s.status === 'capture').length, 1);
    assert.ok(states.slice(11).every((s) => s.status === 'captured'));
  });

  it('a refused photo looks for a suitable face again, with a full new second', () => {
    const machine = createStableFaceCapture(ADULT);
    feed(machine, still(11));
    machine.resume();
    const states = feed(machine, still(11), 100, 2000);
    assert.deepEqual(states[0], { status: 'holding', progress: 0 });
    assert.equal(states[10].status, 'capture');
  });
});

describe('the time allowed for the photo', () => {
  it('runs out with timed_out, from frames or from the clock alone', () => {
    const machine = createStableFaceCapture(ADULT, { timeoutMs: 5000, startedAt: 1000 });
    assert.deepEqual(machine.update([face({ width: 90 })], 3000), { status: 'adjusting', problem: 'too_far' });
    assert.equal(machine.tick(5999), null);
    assert.deepEqual(machine.tick(6000), { status: 'timed_out' });
    assert.deepEqual(machine.update(still(1)[0], 6100), { status: 'timed_out' });
  });

  it('a frame after the time allowed is timed out, not captured', () => {
    const machine = createStableFaceCapture(ADULT, { timeoutMs: 800 });
    const states = feed(machine, still(12));
    assert.equal(states[8].status, 'timed_out');
    assert.ok(states.every((s) => s.status !== 'capture'));
  });

  it('a photo already asked for is not timed out while it is checked and sent', () => {
    const machine = createStableFaceCapture(ADULT, { timeoutMs: 5000 });
    feed(machine, still(11));
    assert.equal(machine.tick(10_000), null);
  });

  it('reset starts the time allowed over', () => {
    const machine = createStableFaceCapture(ADULT, { timeoutMs: 1000 });
    machine.tick(1000);
    machine.reset(5000);
    assert.equal(machine.tick(5500), null);
    assert.deepEqual(machine.update([face()], 5600), { status: 'holding', progress: 0 });
  });
});

describe('what the screen says', () => {
  it('asks to look straight at the camera, then says to stay still once a face is suitable', () => {
    assert.equal(CAPTURE_COPY.instruction, 'Look straight at the camera.');
    assert.equal(captureMessage({ status: 'searching' }, 'self'), 'Look straight at the camera.');
    assert.equal(captureMessage({ status: 'holding', progress: 0.3 }, 'self'), 'Face detected. Please stay still.');
    assert.equal(captureMessage({ status: 'holding', progress: 0.3 }, 'child'), 'Face detected. Please stay still.');
  });

  it('gives an instruction, not a technical error, for every problem and subject', () => {
    for (const subject of ['self', 'member', 'child']) {
      for (const problem of ['no_face', 'several_faces', 'cut_off', 'too_far', 'too_close', 'not_centered', 'turned', 'eyes_closed']) {
        const text = problemMessage(problem, subject);
        assert.ok(text.length > 5 && /\.$/.test(text), `${subject}/${problem}: ${text}`);
        assert.doesNotMatch(text, /error|detector|ML Kit|bounds|yaw/i);
      }
    }
  });

  it('speaks to the adult holding the phone for a child', () => {
    assert.match(problemMessage('too_far', 'child'), /Move the phone/);
    assert.match(problemMessage('turned', 'child'), /Ask them/);
    assert.match(captureGuidance('child', 0), /their eye level/);
    assert.match(captureGuidance('self', 0), /taken automatically/);
  });

  it(`adds a tip after ${CAPTURE_TIP_AFTER_MS / 1000} s without a photo`, () => {
    assert.notEqual(captureGuidance('self', CAPTURE_TIP_AFTER_MS - 1), captureGuidance('self', CAPTURE_TIP_AFTER_MS));
    assert.match(captureGuidance('self', CAPTURE_TIP_AFTER_MS), /brighter/);
  });
});
