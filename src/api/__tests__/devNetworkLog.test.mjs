/** Development-only network logging (devNetworkLog.ts): what is logged for
 *  requests, responses and failures, what is redacted, that it never changes
 *  a call, and that nothing happens outside __DEV__. Synthetic data only. */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import axios, { AxiosError } from 'axios';

import { installAxiosLogging, installFetchLogging, redact, redactUrl, trackNative } from '../devNetworkLog.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));
const SECRET = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjdXN0b21lci0xIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ';

function recorder() {
  const lines = [];
  return { lines, sink: (text) => lines.push(text), all: () => lines.join('\n\n') };
}

function clock(...times) {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)];
}

/** An axios instance whose adapter answers from `answer(config)`. */
function client(answer) {
  // client.ts's own default header.
  return axios.create({ baseURL: 'https://api.test/cb', headers: { 'Content-Type': 'application/json' }, adapter: async (config) => answer(config) });
}
const ok = (config, data, status = 200, headers = {}) => ({ data, status, statusText: 'OK', headers, config, request: {} });
const httpError = (config, status, data) => {
  const response = { data, status, statusText: 'Error', headers: { 'x-request-id': 'trace-err' }, config, request: {} };
  return new AxiosError(`Request failed with status code ${status}`, status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST',
    config, {}, response);
};

/** A fetch target whose fetch answers from `answer`, recording each promise it returns. */
function target(answer) {
  const calls = [];
  const fake = { fetch: (input, init) => { const p = answer(input, init); calls.push(p); return p; } };
  return { fake, calls };
}

beforeEach(() => { globalThis.__DEV__ = true; });
afterEach(() => { delete globalThis.__DEV__; });

describe('axios: requests and responses', () => {
  it('logs the method, full URL, headers, query, body and time, then status, duration, trace id and body', async () => {
    const log = recorder();
    const api = client((config) => ok(config, { id: 'res-1', status: 'upcoming' }, 201, { 'x-request-id': 'trace-201' }));
    installAxiosLogging(api, { sink: log.sink, now: clock(1000, 1245) });
    await api.post('/bookings', { venue: 'Harbor Cruise', guests: 2 }, { params: { include: 'members' } });
    await settle();
    const [request, response] = log.lines;
    assert.match(request, /^\[API REQUEST\] #\d+\nPOST https:\/\/api\.test\/cb\/bookings\nTimestamp: \d{4}-\d\d-\d\dT/);
    assert.match(request, /Headers: \{[^}]*"Content-Type": "application\/json"/s);
    assert.match(request, /Query: \{\n {2}"include": "members"\n\}/);
    assert.match(request, /Body: \{\n {2}"venue": "Harbor Cruise",\n {2}"guests": 2\n\}/);
    assert.match(response, /^\[API RESPONSE\] #\d+\nPOST https:\/\/api\.test\/cb\/bookings\nStatus: 201\nDuration: 245ms\nTrace ID: trace-201\n/);
    assert.match(response, /Response: \{\n {2}"id": "res-1",/);
    assert.equal(request.match(/#(\d+)/)[1], response.match(/#(\d+)/)[1]); // one id pairs them
  });

  it('logs an HTTP 4xx with the server code, body and trace id, and rethrows the very same error', async () => {
    const log = recorder();
    let thrown;
    const api = client((config) => { thrown = httpError(config, 422, { code: 'MEMBER_DOCUMENT_NOT_VERIFIED', message: 'Not verified', trace_id: 'trace-422' }); throw thrown; });
    installAxiosLogging(api, { sink: log.sink, now: clock(0, 80) });
    await assert.rejects(api.patch('/bookings/res-1', { memberIds: ['p-1'] }), (error) => error === thrown && error.response.status === 422);
    await settle();
    const error = log.lines[1];
    assert.match(error, /^\[API ERROR\] #\d+\nPATCH https:\/\/api\.test\/cb\/bookings\/res-1\nStatus: 422\nDuration: 80ms\nError: HTTP_4XX \(ERR_BAD_REQUEST\)\n/);
    assert.match(error, /Server code: MEMBER_DOCUMENT_NOT_VERIFIED/);
    assert.match(error, /Trace ID: trace-err/);
    assert.match(error, /"message": "Not verified"/);
  });

  it('logs an HTTP 5xx as one', async () => {
    const log = recorder();
    const api = client((config) => { throw httpError(config, 503, { code: 'UPSTREAM_UNAVAILABLE' }); });
    installAxiosLogging(api, { sink: log.sink });
    await assert.rejects(api.get('/family'));
    await settle();
    assert.match(log.lines[1], /Status: 503\n.*\nError: HTTP_5XX \(ERR_BAD_RESPONSE\)/s);
  });

  it('logs a network failure and a timeout, with no response', async () => {
    const log = recorder();
    const network = client((config) => { throw new AxiosError('Network Error', 'ERR_NETWORK', config, {}); });
    const slow = client((config) => { throw new AxiosError('timeout of 15000ms exceeded', 'ECONNABORTED', config, {}); });
    installAxiosLogging(network, { sink: log.sink, now: clock(0, 30) });
    installAxiosLogging(slow, { sink: log.sink, now: clock(0, 15001) });
    await assert.rejects(network.get('/documents'));
    await assert.rejects(slow.get('/documents'));
    await settle();
    const [, networkError, , timeout] = log.lines;
    assert.match(networkError, /Status: \(no response\)\nDuration: 30ms\nError: NETWORK \(ERR_NETWORK\)\nMessage: Network Error/);
    assert.match(networkError, /Network: no response \(offline, DNS failure, TLS error or connection refused\)/);
    assert.match(timeout, /Duration: 15001ms\nError: TIMEOUT \(ECONNABORTED\)\nMessage: timeout of 15000ms exceeded/);
    assert.match(timeout, /Network: no response before the timeout/);
  });

  it('never prints the Authorization header, tokens or keys, only that they were sent', async () => {
    const log = recorder();
    const api = client((config) => ok(config, { accessToken: SECRET, refreshToken: 'refresh-secret-123', user: { id: 'u-1' } }));
    installAxiosLogging(api, { sink: log.sink });
    await api.post('/auth/login', { identifier: 'ada@example.com', password: 'Sup3r-secret!' }, {
      headers: { Authorization: `Bearer ${SECRET}`, 'X-Api-Key': 'key-123', Cookie: 'session=abc' },
    });
    await settle();
    const all = log.all();
    for (const leaked of [SECRET, 'refresh-secret-123', 'Sup3r-secret!', 'key-123', 'session=abc', 'ada@example.com']) {
      assert.equal(all.includes(leaked), false, `${leaked} must not be logged`);
    }
    assert.match(all, /"Authorization": "\[REDACTED\]"/);
    assert.match(all, /"identifier": "a\*\*\*@example\.com"/);
    assert.match(all, /"accessToken": "\[REDACTED\]"/);
  });
});

describe('redaction', () => {
  it('redacts nested secrets, document numbers, images and personal data, at any depth', () => {
    const shown = redact({
      password: 'p', otp: '123456', pin: '1234', newPin: '9876', debug_otp: '654321', code: '482913',
      access_token: 'a', refresh_token: 'r', api_key: 'k', client_secret: 's', cookie: 'c',
      profile: {
        fullName: 'Ravi Kumar Example', email: 'ravi@example.com', phone: '+15551234567', dateOfBirth: '1990-01-01',
        address: { line1: '1 Main St', city: 'Mumbai' },
        documents: [{
          passport_number: 'X1234567', document_number: 'D7654321', number: '••••4567', maskedNumber: '••••4567',
          frontImageBase64: 'A'.repeat(5000), portraitImageUrl: 'https://s3.test/p.jpg?X-Amz-Signature=abc',
          status: 'verified', type: 'passport',
        }],
        face: { selfieBase64: 'B'.repeat(100), template: [0.1, 0.2] },
      },
      error: { code: 'RESERVATION_ALREADY_EXISTS', message: 'Already booked' },
    });
    for (const field of ['password', 'otp', 'pin', 'newPin', 'debug_otp', 'code', 'access_token', 'refresh_token', 'api_key', 'client_secret', 'cookie']) {
      assert.equal(shown[field], '[REDACTED]', field);
    }
    const { profile } = shown;
    assert.equal(profile.fullName, 'R*** K*** E***');
    assert.equal(profile.email, 'r***@example.com');
    assert.equal(profile.phone, '***67');
    assert.equal(profile.dateOfBirth, '[REDACTED]');
    assert.equal(profile.address, '[REDACTED]');
    const [doc] = profile.documents;
    assert.equal(doc.passport_number, '[REDACTED]');
    assert.equal(doc.document_number, '[REDACTED]');
    assert.equal(doc.number, '••••4567'); // already masked by the server
    assert.equal(doc.maskedNumber, '••••4567');
    assert.equal(doc.frontImageBase64, '[omitted: 5000 chars]');
    assert.equal(doc.portraitImageUrl, '[omitted: 41 chars]');
    assert.deepEqual([doc.status, doc.type], ['verified', 'passport']);
    assert.equal(profile.face.selfieBase64, '[omitted: 100 chars]');
    assert.equal(profile.face.template, '[omitted]');
    assert.equal(shown.error.code, 'RESERVATION_ALREADY_EXISTS'); // an error code is not a secret
  });

  it('catches secrets by their shape too: JWTs, Bearer values, base64 blobs, data URIs and email addresses', () => {
    const shown = redact({
      note: SECRET, header: `Bearer ${SECRET}`, blob: 'Q'.repeat(4000), uri: 'data:image/png;base64,AAAA',
      sentTo: 'ravi@example.com', recipients: ['sam@example.org'],
    });
    assert.deepEqual(shown, {
      note: '[REDACTED JWT]', header: '[REDACTED]', blob: '[base64 omitted: 4000 chars]', uri: '[data URI omitted: 26 chars]',
      sentTo: 'r***@example.com', recipients: ['s***@example.org'],
    });
  });

  it('is safe with circular, deep, huge and binary values', () => {
    const loop = { name: 'loop' };
    loop.self = loop;
    let deep = { leaf: 1 };
    for (let i = 0; i < 20; i += 1) deep = { deep };
    const shown = redact({ loop, deep, list: Array.from({ length: 80 }, (_, i) => i), text: 'lorem ipsum '.repeat(500), bytes: new Uint8Array(2048) });
    assert.equal(shown.loop.self, '[Circular]');
    assert.match(JSON.stringify(shown.deep), /\[depth limit\]/);
    assert.equal(shown.list.length, 51);
    assert.equal(shown.list[50], '…(+30 more)');
    assert.match(shown.text, /…\(\+5000 chars\)$/); // 6000 characters of prose, 1000 printed
    assert.equal(shown.bytes, '[binary: 2048 bytes]');
  });

  it('keeps file contents out of multipart bodies: field names and file metadata only', () => {
    const form = new FormData();
    form.append('documentType', 'passport');
    form.append('front', new Blob(['%PDF secret bytes'], { type: 'image/jpeg' }), 'front.jpg');
    const browser = redact(form);
    assert.deepEqual(browser.multipart.documentType, 'passport');
    assert.equal(browser.multipart.front.file, true);
    assert.equal(browser.multipart.front.type, 'image/jpeg');
    assert.equal(JSON.stringify(browser).includes('secret bytes'), false);
    // React Native's FormData shape.
    const native = redact({ getParts: () => [
      { fieldName: 'selfie', uri: 'file:///data/selfie.jpg', name: 'selfie.jpg', type: 'image/jpeg' },
      { fieldName: 'personId', string: 'p-1' },
    ] });
    assert.deepEqual(native.multipart, { selfie: { file: true, name: 'selfie.jpg', type: 'image/jpeg' }, personId: 'p-1' });
    assert.equal(JSON.stringify(native).includes('file:///'), false); // never the file's path or bytes
  });

  it('redacts signatures, keys and tokens in query strings', () => {
    assert.equal(
      redactUrl('https://s3.test/up?X-Amz-Credential=AKIA%2F1&X-Amz-Signature=deadbeef&X-Amz-Date=20261115T000000Z&key=abc&a=1'),
      'https://s3.test/up?X-Amz-Credential=%5BREDACTED%5D&X-Amz-Signature=%5BREDACTED%5D&X-Amz-Date=20261115T000000Z&key=%5BREDACTED%5D&a=1',
    );
  });
});

describe('fetch', () => {
  it('logs a request and response, hands back fetch\'s own promise, and leaves the body readable', async () => {
    const log = recorder();
    const { fake, calls } = target(async () => new Response(JSON.stringify({ ok: true, trace_id: 'trace-f' }), {
      status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'trace-hdr' },
    }));
    installFetchLogging(fake, { sink: log.sink, now: clock(0, 42) });
    const promise = fake.fetch('https://api.test/cb/export', { headers: { Authorization: `Bearer ${SECRET}` } });
    assert.equal(promise, calls[0]); // the same promise, not a wrapper
    const response = await promise;
    assert.deepEqual(await response.json(), { ok: true, trace_id: 'trace-f' }); // the caller still reads it
    await settle();
    assert.match(log.lines[0], /^\[API REQUEST\] #\d+\nGET https:\/\/api\.test\/cb\/export\n/);
    assert.match(log.lines[0], /"Authorization": "\[REDACTED\]"/);
    assert.match(log.lines[1], /^\[API RESPONSE\] #\d+\nGET https:\/\/api\.test\/cb\/export\nStatus: 200\nDuration: 42ms\nTrace ID: trace-hdr/);
    assert.equal(log.all().includes(SECRET), false);
  });

  it('logs an HTTP failure (fetch resolves it) and a network failure (rethrown unchanged)', async () => {
    const log = recorder();
    const failure = new TypeError('Network request failed');
    const { fake } = target(async (url) => {
      if (url.includes('down')) throw failure;
      return new Response('<Error><Code>SignatureDoesNotMatch</Code></Error>', { status: 403, headers: { 'content-type': 'application/xml' } });
    });
    installFetchLogging(fake, { sink: log.sink, now: clock(0, 10, 20, 35) });
    const s3 = await fake.fetch('https://s3.test/up?X-Amz-Signature=deadbeef', { method: 'PUT', body: new Uint8Array(4096) });
    assert.equal(s3.status, 403);
    await assert.rejects(fake.fetch('https://down.test/cb/health'), (error) => error === failure);
    await settle();
    const all = log.all();
    assert.match(all, /\[API REQUEST\] #\d+\nPUT https:\/\/s3\.test\/up\?X-Amz-Signature=%5BREDACTED%5D/);
    assert.match(all, /Body: \[binary: 4096 bytes\]/);
    assert.match(all, /\[API ERROR\] #\d+\nPUT https:\/\/s3\.test\/up\?X-Amz-Signature=%5BREDACTED%5D\nStatus: 403\n.*SignatureDoesNotMatch/s);
    assert.match(all, /\[API ERROR\] #\d+\nGET https:\/\/down\.test\/cb\/health\nStatus: \(no response\)\nDuration: 15ms\nError: NETWORK \(TypeError\)\nMessage: Network request failed/);
    assert.equal(all.includes('deadbeef'), false);
  });

  it('does not log local file reads, or print address searches', async () => {
    const log = recorder();
    const { fake } = target(async () => new Response('{"suggestions":[{"text":"1 Main St"}]}', { status: 200, headers: { 'content-type': 'application/json' } }));
    installFetchLogging(fake, { sink: log.sink });
    await fake.fetch('file:///data/user/0/photo.jpg');
    await fake.fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST', headers: { 'X-Goog-Api-Key': 'AIza-secret' }, body: JSON.stringify({ input: '1 Main St, Springfield' }),
    });
    await settle();
    assert.equal(log.lines.length, 2); // the Places request and response only
    assert.equal(log.all().includes('Main St'), false);
    assert.equal(log.all().includes('AIza-secret'), false);
    assert.match(log.all(), /\[not printed: address search\]/);
  });
});

describe('never twice, never outside development, never changing a call', () => {
  it('installing twice logs each call once (axios and fetch)', async () => {
    const log = recorder();
    const api = client((config) => ok(config, {}));
    installAxiosLogging(api, { sink: log.sink });
    installAxiosLogging(api, { sink: log.sink });
    await api.get('/family');
    const { fake } = target(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    installFetchLogging(fake, { sink: log.sink });
    const once = fake.fetch;
    installFetchLogging(fake, { sink: log.sink });
    assert.equal(fake.fetch, once);
    await fake.fetch('https://api.test/cb/health');
    await settle();
    assert.equal(log.lines.length, 4); // one request and one response each
  });

  it('a request replayed after a token refresh is logged as its own, marked request', async () => {
    const log = recorder();
    let calls = 0;
    const api = client((config) => {
      calls += 1;
      if (calls === 1) throw httpError(config, 401, { code: 'TOKEN_EXPIRED' });
      return ok(config, { id: 'u-1' });
    });
    installAxiosLogging(api, { sink: log.sink });
    // client.ts's own refresh interceptor, registered after the logging one.
    api.interceptors.response.use((r) => r, (error) => {
      const original = error.config;
      if (error.response?.status === 401 && !original._retried) {
        original._retried = true;
        original.headers.Authorization = 'Bearer new-token';
        return api(original);
      }
      throw error;
    });
    const response = await api.get('/user/me');
    assert.deepEqual(response.data, { id: 'u-1' });
    await settle();
    assert.equal(log.lines.length, 4);
    assert.match(log.lines[2], /^\[API REQUEST\] #\d+ \(replayed after token refresh\)\nGET https:\/\/api\.test\/cb\/user\/me/);
    assert.equal(log.all().includes('new-token'), false);
  });

  it('the response, the error and the existing interceptors behave exactly as before', async () => {
    const plain = client((config) => ok(config, { echoed: config.headers.Authorization ?? null }));
    const logged = client((config) => ok(config, { echoed: config.headers.Authorization ?? null }));
    installAxiosLogging(logged, { sink: () => {} });
    for (const api of [plain, logged]) {
      api.interceptors.request.use((config) => { config.headers.Authorization = 'Bearer t'; return config; });
    }
    const [a, b] = await Promise.all([plain.get('/x'), logged.get('/x')]);
    assert.deepEqual([a.status, a.data], [b.status, b.data]);
    assert.deepEqual(b.data, { echoed: 'Bearer t' });
  });

  it('with __DEV__ false nothing is installed, wrapped or logged', async () => {
    globalThis.__DEV__ = false;
    const log = recorder();
    const api = client((config) => ok(config, {}));
    const before = [api.interceptors.request.handlers.length, api.interceptors.response.handlers.length];
    installAxiosLogging(api, { sink: log.sink });
    assert.deepEqual([api.interceptors.request.handlers.length, api.interceptors.response.handlers.length], before);
    const { fake } = target(async () => new Response('{}'));
    const original = fake.fetch;
    installFetchLogging(fake, { sink: log.sink });
    assert.equal(fake.fetch, original);
    assert.equal(await trackNative('GET', 'https://api.test/cb/x', {}, async () => 'done', undefined, { sink: log.sink }), 'done');
    await api.get('/family');
    await settle();
    assert.deepEqual(log.lines, []);
    delete globalThis.__DEV__;
    installAxiosLogging(axios.create(), { sink: log.sink }); // __DEV__ not defined at all: still nothing
    assert.deepEqual(log.lines, []);
  });

  it('a native download is logged around the call, which returns or throws unchanged', async () => {
    const log = recorder();
    const result = await trackNative('GET', 'https://api.test/cb/exports/1/download', { Authorization: `Bearer ${SECRET}` },
      async () => ({ size: 2048, uri: 'file:///x.zip' }), (saved) => ({ savedBytes: saved.size }), { sink: log.sink, now: clock(0, 90) });
    assert.deepEqual(result, { size: 2048, uri: 'file:///x.zip' });
    const boom = new Error('download failed');
    await assert.rejects(trackNative('GET', 'https://api.test/cb/exports/2/download', {}, async () => { throw boom; }, undefined, { sink: log.sink }),
      (error) => error === boom);
    await settle();
    assert.match(log.all(), /Status: completed \(native: no HTTP status exposed\)\nDuration: 90ms/);
    assert.match(log.all(), /"savedBytes": 2048/);
    assert.match(log.all(), /\[API ERROR\] #\d+\nGET https:\/\/api\.test\/cb\/exports\/2\/download/);
    assert.equal(log.all().includes(SECRET), false);
  });
});

describe('every request path is hooked', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const clientSource = read('../client.ts');

  it('the shared client logs first, the bare axios (token refresh) and the global fetch are hooked', () => {
    const create = clientSource.slice(clientSource.indexOf('function createClient'));
    const logging = create.indexOf('installAxiosLogging(instance)');
    assert.ok(logging >= 0, 'the shared client is hooked');
    assert.ok(logging < create.indexOf('instance.interceptors.request.use'));
    assert.ok(logging < create.indexOf('instance.interceptors.response.use'));
    assert.match(clientSource, /\ninstallAxiosLogging\(axios\);\r?\ninstallFetchLogging\(\);/);
  });

  it('the native export download is tracked; every other direct call goes through fetch', () => {
    assert.match(read('../../features/settings/dataExport.ts'), /trackNative\('GET', url, headers, \(\) => File\.downloadFileAsync\(/);
    // The direct fetch calls the global fetch wrapper sees. The presigned PUT:
    // endpoints hands the global fetch to putImage, which PUTs through it.
    assert.match(read('../endpoints.ts'), /putImage\(fetch, uploadUrl/);
    assert.match(read('../../features/documents/imageUpload.ts'), /await fetchFn\(uploadUrl, \{ method: 'PUT'/);
    assert.match(read('../../services/places.ts'), /await fetch\(`\$\{BASE\}\/places:autocomplete`/);
  });
});
