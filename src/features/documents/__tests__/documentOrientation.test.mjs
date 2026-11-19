// Full-page documents (A4 birth certificates): the photo keeps the orientation
// it was taken in, portrait or landscape, is never cropped, and what is
// uploaded is that upright JPEG. Passports keep the Regula scanner.
// Run: npm test   (node --test; Node 22.6+ imports the .ts modules directly)
// Images are synthetic header-only JPEGs; no document of anyone.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { DOCUMENT_PHOTO_LIMITS, PHOTO_LONG_SIDE, normalizePhoto } from '../../family/photoNormalize.ts';
import { readImageHeader } from '../../../utils/imageHeader.ts';
import { base64ToBytes, checkImage } from '../imageUpload.ts';

/** A minimal JPEG: SOI, optional EXIF orientation, SOF0 with the size, filler, EOI. */
function jpeg({ width, height, orientation = 1 }) {
  const bytes = [0xff, 0xd8];
  if (orientation !== 1) {
    const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0, 0, 0, 1, 0x00, orientation, 0, 0, 0, 0, 0, 0];
    const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    bytes.push(0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload);
  }
  bytes.push(0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  return Uint8Array.from([...bytes, ...new Array(64).fill(0x55), 0xff, 0xd9]);
}

// Clockwise turn the stored pixels need to be upright, per EXIF orientation.
const NEEDED_TURN = { 1: 0, 3: 180, 6: 90, 8: 270 };

/**
 * A phone's camera file and image decoder. The capture stores `stored`
 * pixels with an EXIF `orientation`; the decoder either applies that tag
 * (`honorsExif`, as iOS and most Android builds do) or keeps the pixels as
 * stored and drops it (the Android behaviour photoNormalize guards against).
 * Tracks the pixel size and how far the content is turned from upright, so a
 * test sees whether the page really ends up upright, not just tall.
 */
function phone({ stored, orientation = 1, honorsExif }) {
  const file = jpeg({ ...stored, orientation });
  const calls = [];
  const io = {
    readHead: () => ({ size: file.length, head: file }),
    readHeader: readImageHeader,
    async encodeJpeg(uri, actions, quality) {
      calls.push({ uri, actions, quality });
      const quarter = NEEDED_TURN[orientation] % 180 === 90;
      let { width, height } = honorsExif && quarter ? { width: stored.height, height: stored.width } : stored;
      let turned = honorsExif ? 0 : (360 - NEEDED_TURN[orientation]) % 360;
      for (const action of actions) {
        if ('rotate' in action) {
          turned = (turned + action.rotate) % 360;
          if (action.rotate % 180 === 90) [width, height] = [height, width];
        } else if ('resize' in action) {
          if ('width' in action.resize) [width, height] = [action.resize.width, Math.round((height * action.resize.width) / width)];
          else [width, height] = [Math.round((width * action.resize.height) / height), action.resize.height];
        } else if (!('flip' in action)) {
          throw new Error(`unexpected action ${JSON.stringify(action)}`);
        }
      }
      calls.at(-1).turned = turned;
      return { uri: `file:///out-${calls.length}.jpg`, width, height, base64: Buffer.from(jpeg({ width, height })).toString('base64') };
    },
  };
  return { io, calls };
}

const shape = (w, h) => (w > h ? 'landscape' : h > w ? 'portrait' : 'square');

async function prepare(capture) {
  const { io, calls } = phone(capture);
  const page = await normalizePhoto('file:///capture.jpg', io, DOCUMENT_PHOTO_LIMITS);
  return { page, calls, last: calls.at(-1) };
}

// What each platform's camera stores for a page held portrait / landscape.
const CAPTURES = {
  'Android portrait page, decoder drops EXIF': { stored: { width: 4000, height: 3000 }, orientation: 6, honorsExif: false, expect: 'portrait' },
  'Android portrait page, decoder applies EXIF': { stored: { width: 4000, height: 3000 }, orientation: 6, honorsExif: true, expect: 'portrait' },
  'Android portrait page held the other way (EXIF 8), decoder drops EXIF': { stored: { width: 4000, height: 3000 }, orientation: 8, honorsExif: false, expect: 'portrait' },
  'Android landscape page': { stored: { width: 4000, height: 3000 }, orientation: 1, honorsExif: false, expect: 'landscape' },
  'iOS portrait page (pixels already upright)': { stored: { width: 3024, height: 4032 }, orientation: 1, honorsExif: true, expect: 'portrait' },
  'iOS portrait page tagged EXIF 6': { stored: { width: 4032, height: 3024 }, orientation: 6, honorsExif: true, expect: 'portrait' },
  'iOS landscape page': { stored: { width: 4032, height: 3024 }, orientation: 1, honorsExif: true, expect: 'landscape' },
};

describe('full-page document photo: orientation', () => {
  for (const [name, capture] of Object.entries(CAPTURES)) {
    it(`${name}: upright ${capture.expect}, never forced to the other orientation`, async () => {
      const { page, last } = await prepare(capture);
      assert.equal(shape(page.width, page.height), capture.expect);
      assert.equal(last.turned, 0, 'the content ends upright');
      assert.equal(Math.max(page.width, page.height), DOCUMENT_PHOTO_LIMITS.longSide);
    });
  }

  it('turns pixels only to apply the camera\'s own EXIF tag, never otherwise', async () => {
    for (const capture of Object.values(CAPTURES)) {
      const { calls } = await prepare(capture);
      const turns = calls.flatMap((c) => c.actions.filter((a) => 'rotate' in a).map((a) => a.rotate));
      const needed = capture.honorsExif ? 0 : NEEDED_TURN[capture.orientation];
      assert.deepEqual(turns.filter((t) => t !== 0), needed && needed % 180 === 90 ? [needed] : []);
    }
  });
});

describe('full-page document photo: the whole page', () => {
  it('never crops: every action is a turn, a flip or a resize, and the aspect ratio is kept', async () => {
    for (const capture of Object.values(CAPTURES)) {
      const { page, calls } = await prepare(capture);
      for (const call of calls) {
        for (const action of call.actions) assert.ok('rotate' in action || 'flip' in action || 'resize' in action, JSON.stringify(action));
      }
      const quarter = NEEDED_TURN[capture.orientation] % 180 === 90;
      const upright = quarter ? capture.stored.height / capture.stored.width : capture.stored.width / capture.stored.height;
      assert.ok(Math.abs(page.width / page.height - upright) < 0.002, `${page.width}x${page.height} keeps ${upright}`);
    }
  });

  it('a document photo is larger than an enrolment photo; enrolment keeps its 1600 px', async () => {
    assert.equal(DOCUMENT_PHOTO_LIMITS.longSide, 2400);
    const { io } = phone({ stored: { width: 4000, height: 3000 }, orientation: 6, honorsExif: true });
    const enrolment = await normalizePhoto('file:///face.jpg', io);
    assert.equal(Math.max(enrolment.width, enrolment.height), PHOTO_LONG_SIDE);
  });
});

describe('full-page document photo: what is uploaded', () => {
  it('the bytes sent are the upright JPEG, in the orientation it was taken', async () => {
    for (const capture of Object.values(CAPTURES)) {
      const { page } = await prepare(capture);
      const bytes = base64ToBytes(page.base64); // as the in-memory upload decodes it
      const sent = checkImage(bytes, 'image/jpeg');
      assert.deepEqual([sent.width, sent.height], [page.width, page.height]);
      assert.equal(shape(sent.width, sent.height), capture.expect);
    }
  });
});

describe('the scan screens', () => {
  const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
  const scan = read('app/document/scan.tsx');

  it('a birth certificate is photographed with the camera, not the ID-document scanner', () => {
    assert.match(scan, /useState\(regulaAvailable && !fullPage\)/);
    assert.match(scan, /if \(!regulaAvailable \|\| fullPage\) return;/);
    assert.match(scan, /normalizeDocumentPhoto\(photo\.uri\)/);
    assert.match(read('features/family/photoNormalizeNative.ts'), /normalizePhoto\(uri, deviceIO, DOCUMENT_PHOTO_LIMITS\)/);
  });

  it('a passport still uses the Regula scanner, with its MRZ scenario', () => {
    assert.match(scan, /scanDocument\(\{ fullPage \}\)/);
    const regula = read('features/documents/regulaScanner.ts');
    assert.match(regula, /SCENARIO_MRZ_AND_LOCATE \?\? 'MrzAndLocate'/);
  });

  it('every view of a scan shows it whole, in its own shape', () => {
    assert.match(scan, /contentFit="contain"/);
    assert.doesNotMatch(scan, /contentFit="cover"/);
    const flows = read('premium/flows/documents.tsx');
    const hero = flows.slice(flows.indexOf('export function ScanHero'));
    assert.match(hero, /contentFit="contain"/);
    assert.match(hero, /setRatio\(w \/ h\)/);
    assert.match(flows, /\/\/ scan taller than that \(an A4 page\) is shown whole, never cropped\.\r?\n\s+contentFit="contain"/);
  });
});
