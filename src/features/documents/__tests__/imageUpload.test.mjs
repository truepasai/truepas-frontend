// Document images: read, checked, then uploaded as their own bytes — or
// stopped before anything is sent.
// Run: npm test   (node --test; Node 22.6+ imports the .ts module directly)
// Images are synthetic header-only byte streams, never a photo of anyone.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  ImageUploadError,
  RESCAN_MESSAGE,
  base64ToBytes,
  checkImage,
  fetchFileReader,
  imageInfo,
  needsRescan,
  prepareImage,
  putImage,
  readImageFile,
  uploadImages,
  uriScheme,
} from '../imageUpload.ts';

const jpeg = (width = 1600, height = 1200, scan = 64) => {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03,
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0, ...new Array(scan).fill(0x5a), 0xff, 0xd9]);
};
const png = (width = 1600, height = 1200) => {
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32(13), 0x49, 0x48, 0x44, 0x52,
    ...u32(width), ...u32(height), 8, 2, 0, 0, 0, 0, 0, 0, 0]);
};
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const text = (s) => new Uint8Array(Buffer.from(s, 'latin1'));

// What Android's expo/fetch answers for a missing local file — the bytes the
// app once uploaded in place of a passport photo.
const FILE_NOT_FOUND = text('File not found');

function recorder() {
  const lines = [];
  return {
    lines,
    info: (event, fields) => lines.push({ event, fields }),
    warn: (event, fields) => lines.push({ event, fields, warn: true }),
    async step(event, run, describe) {
      try {
        const result = await run();
        lines.push({ event: `${event} ok`, fields: describe ? describe(result) : undefined });
        return result;
      } catch (err) {
        lines.push({ event: `${event} failed`, fields: { error: err.message }, warn: true });
        throw err;
      }
    },
  };
}

function fakeApi({ putStatus = 200, failPut = null } = {}) {
  const calls = { urls: [], puts: [] };
  return {
    calls,
    async getUploadUrls(parts, contentType) {
      calls.urls.push({ parts, contentType });
      return {
        uploads: Object.fromEntries(parts.map((part) => [part, {
          uploadUrl: `https://bucket.s3.amazonaws.com/${part}?X-Amz-Signature=secret-${part}`,
          objectKey: `customers/c/documents/d/${part}-key`,
        }])),
      };
    },
    async put(uploadUrl, data, contentType) {
      calls.puts.push({ uploadUrl, data, contentType });
      if (failPut) throw failPut;
      return putStatus;
    },
  };
}

const readerOf = (result) => ({ read: async () => result });
const neverRead = { read: async () => assert.fail('the file system must not be read') };

async function rejectsWith(promise, problem) {
  await assert.rejects(promise, (err) => err instanceof ImageUploadError && err.problem === problem);
}

describe('checking an image', () => {
  it('reads a JPEG and a PNG by signature and header', () => {
    assert.deepEqual(imageInfo(jpeg(1600, 1200)), { format: 'jpeg', contentType: 'image/jpeg', width: 1600, height: 1200 });
    assert.deepEqual(imageInfo(png(1280, 960)), { format: 'png', contentType: 'image/png', width: 1280, height: 960 });
  });

  it('refuses empty bytes', () => {
    assert.throws(() => checkImage(new Uint8Array(0)), (e) => e.problem === 'empty');
  });

  it('refuses "File not found" and other text labelled image/jpeg', () => {
    for (const body of [FILE_NOT_FOUND, text('<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>'), text('{"error":"nope"}')]) {
      assert.throws(() => checkImage(body, 'image/jpeg'), (e) => e.problem === 'not_jpeg_or_png');
    }
  });

  it('refuses a corrupted JPEG: a JPEG signature with a broken or sizeless header', () => {
    const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(40).fill(0x13)]);
    assert.throws(() => checkImage(broken), (e) => e.problem === 'not_jpeg_or_png');
    assert.throws(() => checkImage(jpeg(0, 1200)), (e) => e.problem === 'not_jpeg_or_png');
    assert.throws(() => checkImage(jpeg().slice(0, 24)), (e) => e.problem === 'not_jpeg_or_png'); // cut before the frame
  });

  it('refuses formats the scanner never produces', () => {
    const gif = text('GIF89a\x04\x00\x03\x00\x80\x00\x00');
    const webp = text('RIFF\x24\x00\x00\x00WEBPVP8 ');
    const heic = text('\x00\x00\x00\x18ftypheic\x00\x00\x00\x00');
    for (const bytes of [gif, webp, heic]) assert.throws(() => checkImage(bytes), (e) => e.problem === 'not_jpeg_or_png');
  });

  it('refuses an image that is not the type it was labelled', () => {
    assert.throws(() => checkImage(png(), 'image/jpeg'), (e) => e.problem === 'wrong_type');
    assert.equal(checkImage(png(), 'image/png').format, 'png');
  });
});

describe('base64 from the scanner', () => {
  it('decodes every byte, with or without a data: prefix, padding or line breaks', () => {
    const bytes = new Uint8Array(Array.from({ length: 1001 }, (_, i) => (i * 37) % 256));
    const encoded = b64(bytes);
    assert.deepEqual(base64ToBytes(encoded), bytes);
    assert.deepEqual(base64ToBytes(`data:image/jpeg;base64,${encoded}`), bytes);
    assert.deepEqual(base64ToBytes(encoded.replace(/=+$/, '')), bytes);
    assert.deepEqual(base64ToBytes(encoded.replace(/(.{76})/g, '$1\n')), bytes);
  });

  it('refuses anything that is not base64 rather than decoding part of it', () => {
    for (const bad of ['not base64!!', 'file:///data/user/0/cache/doc.jpg', 'AAAA=AAA', 'A']) {
      assert.throws(() => base64ToBytes(bad), (e) => e instanceof ImageUploadError && e.problem === 'unreadable');
    }
  });
});

describe('reading a local file', () => {
  it('a missing file is refused before anything is sent', async () => {
    await rejectsWith(readImageFile('file:///data/user/0/app/cache/doc-front.jpg', readerOf({ found: false })), 'missing');
  });

  it('an Expo read that answers 404 "File not found" is never the file', async () => {
    let asked = null;
    const reader = fetchFileReader(async (uri) => {
      asked = uri;
      return { ok: false, status: 404, arrayBuffer: async () => FILE_NOT_FOUND.buffer };
    });
    await rejectsWith(readImageFile('blob:https://app.local/123', reader), 'missing');
    assert.equal(asked, 'blob:https://app.local/123');
  });

  it('a read that hands back the "File not found" text is not an image', async () => {
    const api = fakeApi();
    const log = recorder();
    const read = prepareImage({ part: 'front', uri: 'file:///cache/doc-front.jpg' }, readerOf({ found: true, bytes: FILE_NOT_FOUND }), log);
    await rejectsWith(read, 'not_jpeg_or_png');
    assert.deepEqual(api.calls, { urls: [], puts: [] });
    assert.ok(log.lines.some((l) => l.event === 'read front failed' && l.fields.problem === 'not_jpeg_or_png'));
  });

  it('an empty file, or a reader that throws, is refused', async () => {
    await rejectsWith(readImageFile('file:///cache/empty.jpg', readerOf({ found: true, bytes: new Uint8Array(0) })), 'empty');
    await rejectsWith(readImageFile('content://media/1', { read: async () => { throw new Error('permission denied'); } }), 'unreadable');
  });

  it('a data: URI is decoded in memory, without the file system', async () => {
    assert.deepEqual(await readImageFile(`data:image/jpeg;base64,${b64(jpeg())}`, neverRead), jpeg());
  });

  it('logs the scheme of a URI, never its path', () => {
    assert.equal(uriScheme('file:///data/user/0/ai.truepas.app/cache/doc-123-front.jpg'), 'file');
    assert.equal(uriScheme('content://com.android.providers/document/42'), 'content');
    assert.equal(uriScheme('/no/scheme'), 'none');
  });
});

describe('uploading the scan', () => {
  it('a JPEG scan goes up as its own bytes, as image/jpeg, from memory', async () => {
    const api = fakeApi();
    const log = recorder();
    const image = await prepareImage({ part: 'front', base64: b64(jpeg()) }, neverRead, log);
    const keys = await uploadImages([image], api, log);
    assert.deepEqual(keys, { front: 'customers/c/documents/d/front-key' });
    assert.deepEqual(api.calls.urls, [{ parts: ['front'], contentType: 'image/jpeg' }]);
    assert.equal(api.calls.puts.length, 1);
    assert.deepEqual(api.calls.puts[0].data, jpeg());
    assert.equal(api.calls.puts[0].contentType, 'image/jpeg');
  });

  it('a PNG scan (iOS Document Reader) is labelled image/png, not image/jpeg', async () => {
    const api = fakeApi();
    const image = await prepareImage({ part: 'front', base64: b64(png()) }, neverRead, recorder());
    await uploadImages([image], api, recorder());
    assert.deepEqual(api.calls.urls, [{ parts: ['front'], contentType: 'image/png' }]);
    assert.equal(api.calls.puts[0].contentType, 'image/png');
    assert.deepEqual(api.calls.puts[0].data, png());
  });

  it('a front and back of one type share one upload-urls request; mixed types get one each', async () => {
    const same = fakeApi();
    const log = recorder();
    const front = await prepareImage({ part: 'front', base64: b64(jpeg()) }, neverRead, log);
    const back = await prepareImage({ part: 'back', base64: b64(jpeg(800, 600)) }, neverRead, log);
    await uploadImages([front, back], same, log);
    assert.deepEqual(same.calls.urls, [{ parts: ['front', 'back'], contentType: 'image/jpeg' }]);
    const mixed = fakeApi();
    const pngBack = await prepareImage({ part: 'back', base64: b64(png()) }, neverRead, log);
    await uploadImages([front, pngBack], mixed, log);
    assert.deepEqual(mixed.calls.urls.map((c) => c.contentType), ['image/jpeg', 'image/png']);
  });

  it('a failed upload is an error with no object keys, after the put phase began', async () => {
    const api = fakeApi({ failPut: new Error('Upload failed (403 SignatureDoesNotMatch)') });
    const phases = [];
    const image = await prepareImage({ part: 'front', base64: b64(jpeg()) }, neverRead, recorder());
    await assert.rejects(uploadImages([image], api, recorder(), (p) => phases.push(p)), /Upload failed \(403 SignatureDoesNotMatch\)/);
    assert.deepEqual(phases, ['urls', 'put']);
  });

  it('nothing is uploaded when an image fails its check', async () => {
    const api = fakeApi();
    for (const source of [
      { part: 'front', base64: b64(FILE_NOT_FOUND) },
      { part: 'front', base64: '' },
      { part: 'front', base64: 'not base64!!' },
      { part: 'front', uri: 'file:///cache/missing.jpg' },
    ]) {
      await assert.rejects(prepareImage(source, readerOf({ found: false }), recorder()), ImageUploadError);
    }
    assert.deepEqual(api.calls, { urls: [], puts: [] });
  });

  it('logs read and upload steps with sizes, formats and status; never bytes, base64 or URLs', async () => {
    const api = fakeApi({ putStatus: 200 });
    const log = recorder();
    const encoded = b64(jpeg());
    const image = await prepareImage({ part: 'front', base64: encoded }, neverRead, log);
    await uploadImages([image], api, log);
    const events = log.lines.map((l) => l.event);
    assert.deepEqual(events, ['read front started', 'read front ok', 'upload-urls ok', 'put front started', 'put front ok']);
    const read = log.lines.find((l) => l.event === 'read front ok').fields;
    assert.deepEqual(read, { source: 'memory', bytes: jpeg().length, format: 'jpeg', size: '1600x1200' });
    assert.deepEqual(log.lines.find((l) => l.event === 'put front ok').fields, { status: 200, bytes: jpeg().length, type: 'image/jpeg' });
    const printed = JSON.stringify(log.lines);
    assert.ok(!printed.includes(encoded.slice(0, 16)), 'no base64');
    assert.ok(!printed.includes('X-Amz-Signature') && !printed.includes('s3.amazonaws.com'), 'no presigned URL');
  });
});

describe('the PUT to S3', () => {
  it('sends exactly the image bytes with the signed content type', async () => {
    const sent = [];
    const fetchFn = async (url, init) => {
      sent.push({ url, init });
      return { ok: true, status: 200, text: async () => '' };
    };
    const bytes = jpeg();
    assert.equal(await putImage(fetchFn, 'https://bucket/front?sig', bytes, 'image/jpeg'), 200);
    assert.equal(sent[0].init.method, 'PUT');
    assert.deepEqual(sent[0].init.headers, { 'Content-Type': 'image/jpeg' });
    assert.ok(sent[0].init.body instanceof Uint8Array);
    assert.deepEqual(sent[0].init.body, bytes);
  });

  it('sends only a view’s bytes, never the rest of its buffer', async () => {
    let body = null;
    const whole = new Uint8Array([1, 2, 3, ...jpeg(), 9, 9]);
    const view = whole.subarray(3, 3 + jpeg().length);
    await putImage(async (_url, init) => { body = init.body; return { ok: true, status: 200, text: async () => '' }; }, 'u', view, 'image/jpeg');
    assert.equal(body.buffer.byteLength, jpeg().length);
    assert.deepEqual(body, jpeg());
  });

  it('a non-2xx is an error naming the status and S3 code', async () => {
    const fetchFn = async () => ({ ok: false, status: 403, text: async () => '<Error><Code>SignatureDoesNotMatch</Code></Error>' });
    await assert.rejects(putImage(fetchFn, 'u', jpeg(), 'image/jpeg'), /Upload failed \(403 SignatureDoesNotMatch\)/);
  });
});

describe('what the screens offer after an unreadable scan', () => {
  it('a new scan, for this phone failing to read it and for the server refusing it', () => {
    assert.equal(needsRescan(new ImageUploadError('missing')), true);
    for (const code of ['INVALID_DOCUMENT_IMAGE', 'DOCUMENT_IMAGE_TOO_LARGE', 'UNSUPPORTED_DOCUMENT_IMAGE']) {
      assert.equal(needsRescan(new Error('x'), code), true, code);
    }
    assert.equal(needsRescan(new Error('Network request failed'), undefined), false);
    assert.equal(needsRescan(new Error('busy'), 'SERVICE_UNAVAILABLE'), false);
    assert.match(RESCAN_MESSAGE, /scan the document again/);
  });
});

describe('the document flow no longer reads its scan back through fetch', () => {
  const source = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

  it('verifyWithUploads uploads checked bytes, with no temporary file', () => {
    const flow = source('features/documents/verifyWithUploads.ts');
    assert.match(flow, /prepareImage\(/);
    assert.match(flow, /uploadImages\(/);
    assert.doesNotMatch(flow, /Paths\.cache|EncodingType|uploadFileToUrl/);
  });

  it('putFile reads local files with expo-file-system, never fetch(fileUri)', () => {
    const endpoints = source('api/endpoints.ts');
    assert.doesNotMatch(endpoints, /fetch\(fileUri\)/);
    assert.match(endpoints, /readImageFile\(fileUri, localImageReader\)/);
    const native = source('features/documents/imageUploadNative.ts');
    assert.match(native, /new File\(uri\)/);
    assert.match(native, /file\.exists/);
  });

  it('both document screens offer a new scan for an unreadable one', () => {
    assert.match(source('app/family/add/processing.tsx'), /needsRescan\(err, apiErr\.serverCode\)/);
    assert.match(source('app/document/processing.tsx'), /rescan \? \(\s*<Button label="Scan again"/);
  });
});
