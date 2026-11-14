// Regula's own liveness screens in TruePas colors and words, through the
// Face SDK's supported customization only.
// Run: npm test   (node --test; Node 22.6+ imports the .ts module directly)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { argb, regulaAppearance, regulaColors, regulaStrings } from '../regulaAppearance.ts';

const PALETTE = { background: '#011B27', accent: '#08B6FC', accentLight: '#84DBFE', text: '#FFFFFF' };

// The installed SDK's own CustomizationColors class: every name used must be one of its setters.
const SDK_COLORS = readFileSync(
  new URL('../../../../node_modules/@regulaforensics/face-sdk/www/react-native/customization/customization_colors.js', import.meta.url),
  'utf8',
);

// The Face SDK's string names in the Android dev build 52c795a2 (aapt2 dump
// resources), the only keys its localization callback is asked for.
const SDK_STRING_KEYS = new Set([
  'faceLivenessCameraLayoutPreparingService',
  'faceLivenessShowOnlyOneFace',
  'hint.AddMoreLight',
  'hint.Blink',
  'hint.ChangeBackground',
  'hint.CleanCamera',
  'hint.MakeFaceFullyVisible',
  'hint.TurnDown',
  'hint.TurnLeft',
  'hint.TurnRight',
  'hint.TurnUp',
  'hint.WipeOutOcclusions',
  'hint.addIllumination',
  'hint.fit2',
  'hint.lookStraight',
  'hint.moveAway',
  'hint.moveCloser',
  'hint.removeOcclusion',
  'hint.stayStill',
  'hint.turnHead',
  'livenessDone.status',
  'livenessGuide.button',
  'livenessGuide.head',
  'livenessProcessing.title.processing',
  'livenessRetry.action.retry',
  'livenessRetry.text.environment',
  'livenessRetry.text.guidelines',
  'livenessRetry.text.subject',
  'livenessRetry.text.tooMuchTurn',
  'livenessRetry.title.tryAgain',
]);

describe('colors as the SDK takes them', () => {
  it('#RRGGBB and an opacity become an AARRGGBB integer', () => {
    assert.equal(argb('#011B27'), 0xff011b27);
    assert.equal(argb('#FFFFFF', 0), 0x00ffffff);
    assert.equal(argb('#08b6fc', 0.5), 0x8008b6fc);
  });

  it('a malformed color is refused rather than sent', () => {
    assert.throws(() => argb('red'));
    assert.throws(() => argb('#FFF'));
  });

  it('every color used is a real CustomizationColors setter of the installed SDK', () => {
    for (const name of Object.keys(regulaColors(PALETTE))) {
      assert.match(SDK_COLORS, new RegExp(`set ${name}\\(val\\)`), name);
    }
  });

  it("Regula's processing, retry and success screens take the TruePas navy, not white", () => {
    const colors = regulaColors(PALETTE);
    for (const name of ['processingScreenBackground', 'retryScreenBackground', 'successScreenBackground', 'onboardingScreenBackground']) {
      assert.equal(colors[name], 0xff011b27, name);
    }
  });

  it("the camera oval, its progress and Regula's buttons take the TruePas sky", () => {
    const colors = regulaColors(PALETTE);
    for (const name of ['cameraScreenStrokeActive', 'cameraScreenSectorActive', 'processingScreenProgress', 'retryScreenRetryButtonBackground']) {
      assert.equal(colors[name], 0xff08b6fc, name);
    }
  });

  it('every value is a 32-bit color', () => {
    for (const value of Object.values(regulaColors(PALETTE))) {
      assert.ok(Number.isInteger(value) && value >= 0 && value <= 0xffffffff);
    }
  });
});

describe("Regula's text in TruePas words", () => {
  it("uses only the SDK's own string names", () => {
    for (const subject of ['self', 'member', 'child']) {
      for (const key of Object.keys(regulaStrings(subject))) {
        assert.ok(SDK_STRING_KEYS.has(key), `${subject}: ${key}`);
      }
    }
  });

  it('matches the TruePas photo step', () => {
    const strings = regulaStrings('self');
    assert.equal(strings['hint.lookStraight'], 'Look straight at the camera');
    assert.equal(strings['hint.stayStill'], 'Face detected. Please stay still');
  });

  it('speaks to the adult holding the phone for a child', () => {
    const strings = regulaStrings('child');
    assert.match(strings['hint.lookStraight'], /^Ask them/);
    assert.match(strings['hint.moveCloser'], /Move the phone/);
    assert.match(strings['hint.turnHead'], /^Ask them/);
    // Everything not reworded for a child stays the TruePas wording.
    assert.equal(strings['livenessProcessing.title.processing'], regulaStrings('self')['livenessProcessing.title.processing']);
  });
});

describe('the whole appearance', () => {
  it("offers Regula's camera switch only for a child, as the TruePas screen does", () => {
    assert.equal(regulaAppearance(PALETTE, 'child').cameraSwitch, true);
    assert.equal(regulaAppearance(PALETTE, 'self').cameraSwitch, false);
    assert.equal(regulaAppearance(PALETTE, 'member').cameraSwitch, false);
  });
});
