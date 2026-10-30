// Preparing the under-5 enrolment photo: real JPEG, upright, ≤1600 px, checked.
// Run: npm test   (node --test; Node 22.6+ imports the .ts module directly)
// Images are synthetic byte streams — a JPEG header with a size and EXIF
// orientation, filler for the pixels — never a photo of anyone.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { describe, it } from 'node:test';

import { readImageHeader } from '../../../utils/imageHeader.ts';
import {
  MAX_PHOTO_BYTES,
  PHOTO_LONG_SIDE,
  PHOTO_QUALITY,
  PHOTO_RETRY_QUALITY,
  PhotoNormalizeError,
  base64Size,
  checkJpeg,
  exifActions,
  normalizePhoto,
  resizeFor,
} from '../photoNormalize.ts';

/** A minimal JPEG: SOI, optional EXIF orientation, SOF0 with the size, filler, EOI. */
function jpeg({ width, height, orientation = 1, filler = 64, end = true }) {
  const bytes = [0xff, 0xd8];
  if (orientation !== 1) {
    const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0, 0, 0, 1, 0x00, orientation, 0, 0, 0, 0, 0, 0];
    const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    const length = payload.length + 2;
    bytes.push(0xff, 0xe1, length >> 8, length & 255, ...payload);
  }
  bytes.push(0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  const out = new Uint8Array(bytes.length + filler + (end ? 2 : 0));
  out.set(bytes);
  out.fill(0x55, bytes.length, bytes.length + filler);
  if (end) out.set([0xff, 0xd9], bytes.length + filler);
  return out;
}

/** The start of an iPhone HEIC file: an ISO-BMFF "ftyp" box, brand "heic". */
const HEIC = Uint8Array.from([0, 0, 0, 0x18, ...Buffer.from('ftypheic'), 0, 0, 0, 0, ...Buffer.from('mif1heic'), ...new Array(64).fill(0)]);

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const encoded = (uri, width, height, extra = {}) => ({ uri, width, height, base64: b64(jpeg({ width, height, ...extra })) });

/** A phone stand-in: `file` is what the capture holds; `encode` answers each manipulator call. */
function phone(file, encode) {
  const calls = [];
  return {
    calls,
    io: {
      readHead: () => (file === null ? null : { size: file.length, head: file.slice(0, 256 * 1024) }),
      encodeJpeg: async (uri, actions, quality) => {
        calls.push({ uri, actions, quality });
        return encode(uri, actions, quality, calls.length);
      },
      readHeader: readImageHeader,
    },
  };
}

describe('resizing', () => {
  it('brings the longest side down to 1600 px and keeps the aspect ratio', () => {
    assert.deepEqual(resizeFor(4000, 3000), { resize: { width: PHOTO_LONG_SIDE } });
    assert.deepEqual(resizeFor(3024, 4032), { resize: { height: PHOTO_LONG_SIDE } });
  });
  it('never enlarges a photo that already fits', () => {
    assert.equal(resizeFor(1200, 900), null);
    assert.equal(resizeFor(1600, 1200), null);
  });
});

describe('EXIF turns, used only when decoding ignored the tag', () => {
  it('turns each orientation upright', () => {
    assert.deepEqual(exifActions(1), []);
    assert.deepEqual(exifActions(3), [{ rotate: 180 }]);
    assert.deepEqual(exifActions(6), [{ rotate: 90 }]);
    assert.deepEqual(exifActions(8), [{ rotate: 270 }]);
    assert.deepEqual(exifActions(5), [{ rotate: 90 }, { flip: 'horizontal' }]);
    assert.deepEqual(exifActions(7), [{ rotate: 270 }, { flip: 'horizontal' }]);
  });
});

describe('normalizePhoto', () => {
  it('turns a 12 MP portrait capture (stored sideways, EXIF 6) into an upright 1600 px JPEG', async () => {
    const { io, calls } = phone(jpeg({ width: 4032, height: 3024, orientation: 6 }), (uri) => encoded('out.jpg', 1200, 1600));
    const photo = await normalizePhoto('file:///capture.jpg', io);
    assert.deepEqual(calls, [{ uri: 'file:///capture.jpg', actions: [{ resize: { height: 1600 } }], quality: PHOTO_QUALITY }]);
    assert.equal(photo.width, 1200);
    assert.equal(photo.height, 1600);
    assert.equal(photo.uri, 'out.jpg');
    assert.equal(photo.label.startsWith('4032x3024 exif=6 '), true);
    assert.match(photo.label, /→ 1200x1600 \d+KB$/);
  });

  it('converts an iPhone HEIC capture to a real JPEG on the phone, then resizes it', async () => {
    const { io, calls } = phone(HEIC, (uri, actions, quality, n) =>
      n === 1 ? encoded('decoded.jpg', 3024, 4032) : encoded('out.jpg', 1200, 1600),
    );
    const photo = await normalizePhoto('file:///capture.heic', io);
    // First a full-size decode to learn the size, then the resize from that JPEG.
    assert.deepEqual(calls[0], { uri: 'file:///capture.heic', actions: [], quality: 0.92 });
    assert.deepEqual(calls[1], { uri: 'decoded.jpg', actions: [{ resize: { height: 1600 } }], quality: PHOTO_QUALITY });
    const bytes = Buffer.from(photo.base64, 'base64');
    assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff], 'JPEG start marker');
    assert.deepEqual([...bytes.subarray(-2)], [0xff, 0xd9], 'JPEG end marker');
    assert.equal(readImageHeader(bytes).format, 'jpeg');
    assert.match(photo.label, /^unknown format /);
  });

  it('keeps a photo that is already small at its size', async () => {
    const { io, calls } = phone(jpeg({ width: 1200, height: 900 }), () => encoded('out.jpg', 1200, 900));
    await normalizePhoto('file:///small.jpg', io);
    assert.deepEqual(calls[0].actions, []);
  });

  it('turns the pixels itself when decoding dropped the EXIF tag without applying it', async () => {
    const { io, calls } = phone(jpeg({ width: 4032, height: 3024, orientation: 6 }), (uri, actions, q, n) =>
      n === 1 ? encoded('sideways.jpg', 1600, 1200) : encoded('upright.jpg', 1200, 1600),
    );
    const photo = await normalizePhoto('file:///capture.jpg', io);
    assert.deepEqual(calls[1].actions, [{ rotate: 90 }, { resize: { height: 1600 } }]);
    assert.equal(photo.uri, 'upright.jpg');
  });

  it('refuses a photo it cannot turn upright rather than send the face sideways', async () => {
    const { io } = phone(jpeg({ width: 4032, height: 3024, orientation: 6 }), () => encoded('sideways.jpg', 1600, 1200));
    await assert.rejects(normalizePhoto('file:///capture.jpg', io), (e) => e instanceof PhotoNormalizeError && e.problem === 'unreadable');
  });

  it('re-encodes once at lower quality when the first JPEG is over the size limit', async () => {
    const big = (uri) => ({ ...encoded(uri, 1200, 1600, { filler: MAX_PHOTO_BYTES + 10 }) });
    const { io, calls } = phone(jpeg({ width: 3024, height: 4032 }), (uri, actions, quality) =>
      quality === PHOTO_QUALITY ? big('big.jpg') : encoded('smaller.jpg', 1200, 1600),
    );
    const photo = await normalizePhoto('file:///capture.jpg', io);
    assert.deepEqual(calls.map((c) => c.quality), [PHOTO_QUALITY, PHOTO_RETRY_QUALITY]);
    assert.equal(photo.uri, 'smaller.jpg');
    assert.ok(photo.bytes <= MAX_PHOTO_BYTES);
  });

  it('refuses a photo still over the limit after the smaller re-encode', async () => {
    const { io } = phone(jpeg({ width: 3024, height: 4032 }), (uri) => encoded(uri, 1200, 1600, { filler: MAX_PHOTO_BYTES + 10 }));
    await assert.rejects(normalizePhoto('file:///capture.jpg', io), (e) => e.problem === 'too_large');
  });

  it('refuses an empty, unreadable or corrupt capture with a message to retake it', async () => {
    const empty = phone(new Uint8Array(0), () => assert.fail('nothing to encode'));
    await assert.rejects(normalizePhoto('file:///empty.jpg', empty.io), (e) => e.problem === 'empty' && /take the photo again/.test(e.message));
    const missing = phone(null, () => assert.fail('nothing to encode'));
    await assert.rejects(normalizePhoto('file:///gone.jpg', missing.io), (e) => e.problem === 'unreadable');
    const corrupt = phone(HEIC, () => {
      throw new Error('decoder failed');
    });
    await assert.rejects(normalizePhoto('file:///corrupt.heic', corrupt.io), (e) => e.problem === 'unreadable');
  });
});

describe('checkJpeg — what is uploaded is the JPEG that was checked', () => {
  const image = (bytes, width, height, base64 = b64(bytes)) => ({ uri: 'x.jpg', width, height, base64 });

  it('accepts a complete JPEG and returns its exact byte size', () => {
    const bytes = jpeg({ width: 1200, height: 1600 });
    assert.equal(checkJpeg(image(bytes, 1200, 1600), readImageHeader), bytes.length);
  });

  it('refuses a PNG, a truncated JPEG, or one whose size disagrees', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(40).fill(0)]);
    assert.throws(() => checkJpeg(image(png, 10, 10), readImageHeader), (e) => e.problem === 'not_jpeg');
    assert.throws(() => checkJpeg(image(jpeg({ width: 1200, height: 1600, end: false }), 1200, 1600), readImageHeader), (e) => e.problem === 'not_jpeg');
    assert.throws(() => checkJpeg(image(jpeg({ width: 800, height: 600 }), 1200, 1600), readImageHeader), (e) => e.problem === 'not_jpeg');
  });

  it('refuses base64 the BFF would reject: line breaks, a data: prefix, bad padding', () => {
    const good = b64(jpeg({ width: 1200, height: 1600 }));
    for (const bad of [`${good.slice(0, 76)}\n${good.slice(76)}`, `data:image/jpeg;base64,${good}`, good.slice(0, -1), '']) {
      assert.throws(() => checkJpeg({ uri: 'x', width: 1200, height: 1600, base64: bad }, readImageHeader), (e) => e.problem === 'not_jpeg');
    }
  });

  it('counts decoded bytes exactly for every padding', () => {
    for (const n of [1, 2, 3, 4, 5, 300]) {
      const bytes = new Uint8Array(n).fill(7);
      assert.equal(base64Size(b64(bytes)), n);
    }
  });
});
