import type { AxiosError, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

/**
 * Development-only network logging: every request the app makes, with its
 * response or failure, in the Metro console. Secrets, document numbers,
 * images, biometrics and personal data are redacted (redact below).
 *
 * Installed once per client (client.ts): the shared Axios client, the bare
 * axios that refreshes the access token, and the global fetch, which covers
 * every direct fetch (presigned uploads, Google Places, the web export
 * download) and any library that calls fetch. A native download, which no
 * JavaScript hook sees, is logged with trackNative.
 *
 * Inert outside development: every entry point checks `__DEV__` itself, never
 * an environment variable, and installs or logs nothing when it is false;
 * release builds also strip console.log (babel.config.js). Logging only reads:
 * it never rewrites a request, response or error, prints after the call has
 * moved on, and a failure of its own is swallowed.
 */

/** True only in a development build (Metro's `__DEV__`), read on every call. */
export function devLoggingEnabled(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

export type DevLogOptions = {
  /** Where lines go (default console.log; never console.error, which release builds keep). */
  sink?: (text: string) => void;
  /** Milliseconds for durations (default performance.now, else Date.now). */
  now?: () => number;
};

const REDACTED = '[REDACTED]';
const MAX_STRING = 1000;
const MAX_ITEMS = 50;
const MAX_DEPTH = 8;
const MAX_OUTPUT = 4000;
const MAX_FETCH_BODY_BYTES = 256 * 1024;
const AXIOS_MARK = Symbol.for('truepas.devNetworkLog.axios');
const FETCH_MARK = Symbol.for('truepas.devNetworkLog.fetch');

let sequence = 0;

const defaultNow = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
const defer = (task: () => void) => setTimeout(() => {
  try {
    task();
  } catch {
    // Logging never breaks the app.
  }
}, 0);

// ── Redaction ─────────────────────────────────────────────────────────────

const norm = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');

// Any key containing one of these is a secret.
const SECRET_PARTS = ['password', 'passcode', 'passphrase', 'token', 'secret', 'apikey', 'authorization',
  'cookie', 'signature', 'credential', 'privatekey'];
// Identity document numbers (a value the server already masked, "••••1234", stays).
const DOCUMENT_NUMBER_KEYS = new Set(['documentnumber', 'passportnumber', 'licensenumber', 'licencenumber',
  'drivinglicensenumber', 'idnumber', 'nationalid', 'nationalidnumber', 'aadhaar', 'aadhaarnumber', 'pan',
  'pannumber', 'extracteddocumentnumber', 'number', 'documentno', 'mrz', 'ssn']);
// Images and biometrics: never printed, only their size.
const BINARY_PARTS = ['image', 'photo', 'selfie', 'portrait', 'base64', 'template', 'embedding', 'biometric',
  'liveportrait', 'frame', 'signatureimage'];
const NAME_KEYS = new Set(['name', 'fullname', 'firstname', 'lastname', 'middlename', 'givenname', 'givennames',
  'surname', 'familyname', 'extractedname', 'extractedgivennames', 'extractedsurname', 'ownername', 'holdername']);
const DATE_OF_BIRTH_KEYS = new Set(['dob', 'dateofbirth', 'birthdate', 'extracteddob']);
const ADDRESS_PARTS = ['address', 'street', 'line1', 'line2', 'postalcode', 'postcode', 'zipcode'];

function secretKey(key: string): boolean {
  const k = norm(key);
  return (
    SECRET_PARTS.some((part) => k.includes(part))
    || k.endsWith('pin') || k === 'pincode'
    || k.endsWith('otp') || k === 'otpcode'
    || k === 'cvv' || k === 'key'
  );
}

const looksMasked = (value: string) => /^[•*xX\s-]{2,}[A-Za-z0-9]{0,4}$/.test(value);
const maskName = (value: string) => value.split(/\s+/).filter(Boolean).map((word) => `${word[0]}***`).join(' ');
const maskEmail = (value: string) => {
  const at = value.indexOf('@');
  return at > 0 ? `${value[0]}***${value.slice(at)}` : REDACTED;
};
const maskPhone = (value: string) => {
  const digits = value.replace(/\D/g, '');
  return digits.length > 2 ? `***${digits.slice(-2)}` : REDACTED;
};

/** A field's value as it may be printed, by its name (null: no rule for it). */
function byKey(key: string, value: unknown): unknown {
  const k = norm(key);
  if (secretKey(key)) return REDACTED;
  if (BINARY_PARTS.some((part) => k.includes(part))) {
    return typeof value === 'string' ? `[omitted: ${value.length} chars]` : value == null ? value : '[omitted]';
  }
  if (DOCUMENT_NUMBER_KEYS.has(k)) return typeof value === 'string' && looksMasked(value) ? value : value == null ? value : REDACTED;
  if (DATE_OF_BIRTH_KEYS.has(k)) return value == null ? value : REDACTED;
  if (ADDRESS_PARTS.some((part) => k.includes(part))) return value == null ? value : REDACTED;
  if (typeof value === 'string') {
    if (NAME_KEYS.has(k)) return maskName(value);
    if (k.includes('email')) return maskEmail(value);
    if (k.includes('phone') || k.includes('mobile') || k === 'msisdn') return maskPhone(value);
    // The sign-in identifier: an email address or a phone number.
    if (k === 'identifier' || k === 'username') return value.includes('@') ? maskEmail(value) : maskPhone(value);
    // A one-time code sent as `code` (a server's error code is letters, and stays).
    if (k === 'code' && /^\d{4,8}$/.test(value)) return REDACTED;
  }
  return null;
}

function redactString(value: string): string {
  if (/^Bearer\s/i.test(value)) return REDACTED;
  if (/^eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*$/.test(value)) return '[REDACTED JWT]';
  // An email address under any name.
  if (value.length < 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return maskEmail(value);
  if (value.startsWith('data:')) return `[data URI omitted: ${value.length} chars]`;
  if (value.length > 256 && /^[A-Za-z0-9+/=_-]+$/.test(value.slice(0, 256))) return `[base64 omitted: ${value.length} chars]`;
  if (value.length > MAX_STRING) return `${value.slice(0, MAX_STRING)}…(+${value.length - MAX_STRING} chars)`;
  return value;
}

/** Whether `value` is binary data (bytes, a Blob, a File): only its size is printed. */
function describeBinary(value: unknown): string | null {
  if (typeof ArrayBuffer !== 'undefined' && (value instanceof ArrayBuffer || ArrayBuffer.isView(value as ArrayBufferView))) {
    return `[binary: ${(value as ArrayBuffer).byteLength} bytes]`;
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) return `[Blob: ${value.type || 'no type'}, ${value.size} bytes]`;
  return null;
}

/** A multipart body: field names, and for files only their name and type. */
function describeFormData(value: unknown): Record<string, unknown> | null {
  const form = value as { getParts?: () => unknown[]; entries?: () => Iterable<[string, unknown]> } | null;
  if (!form || typeof form !== 'object') return null;
  let parts: [string, unknown][] | null = null;
  if (typeof form.getParts === 'function') {
    // React Native's FormData: [{ fieldName, string } | { fieldName, uri, name, type }].
    parts = (form.getParts() as { fieldName?: string; string?: string }[]).map((part) => [part.fieldName ?? '?', part.string ?? part]);
  } else if (typeof FormData !== 'undefined' && value instanceof FormData && typeof form.entries === 'function') {
    parts = [...form.entries()];
  }
  if (!parts) return null;
  const fields: Record<string, unknown> = {};
  for (const [name, part] of parts) {
    const file = part as { uri?: string; name?: string; type?: string; size?: number } | string;
    fields[name] = typeof file === 'string'
      ? byKey(name, file) ?? redactString(file).slice(0, 200)
      : { file: true, name: file?.name ?? null, type: file?.type ?? null, ...(typeof file?.size === 'number' ? { size: file.size } : {}) };
  }
  return { multipart: fields };
}

/** A copy of `value` safe to print: recursive, circular-safe and bounded. */
export function redact(value: unknown, key?: string, seen: WeakSet<object> = new WeakSet(), depth = 0): unknown {
  if (key !== undefined) {
    const ruled = byKey(key, value);
    if (ruled !== null) return ruled;
  }
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return typeof value === 'function' ? '[function]' : value;
  const binary = describeBinary(value);
  if (binary) return binary;
  const form = describeFormData(value);
  if (form) return form;
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[depth limit]';
  seen.add(value);
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((item) => redact(item, undefined, seen, depth + 1));
    if (value.length > MAX_ITEMS) items.push(`…(+${value.length - MAX_ITEMS} more)`);
    return items;
  }
  const out: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(value as Record<string, unknown>)) {
    out[name] = redact(item, name, seen, depth + 1);
  }
  return out;
}

/** Headers as a plain object (AxiosHeaders, Headers, pairs or a record), redacted. */
function redactHeaders(headers: unknown): Record<string, unknown> {
  const plain: Record<string, unknown> = {};
  const source = headers as { toJSON?: () => Record<string, unknown>; forEach?: (fn: (v: string, k: string) => void) => void } | null;
  if (!source) return plain;
  if (Array.isArray(source)) {
    for (const [name, value] of source as [string, string][]) plain[name] = value;
  } else if (typeof source.toJSON === 'function') {
    Object.assign(plain, source.toJSON());
  } else if (typeof Headers !== 'undefined' && source instanceof Headers) {
    source.forEach((value, name) => { plain[name] = value; });
  } else {
    Object.assign(plain, source);
  }
  return redact(plain) as Record<string, unknown>;
}

/** The URL with sensitive query values (signatures, keys, tokens) replaced. */
export function redactUrl(url: string): string {
  const [base, query] = url.split('?', 2);
  if (query === undefined) return url;
  const [search, hash] = query.split('#', 2);
  const params = search.split('&').map((pair) => {
    const [name, ...rest] = pair.split('=');
    if (!rest.length) return pair;
    const value = safeDecode(rest.join('='));
    const shown = redact(value, safeDecode(name));
    return shown === value ? pair : `${name}=${encodeURIComponent(String(shown))}`;
  });
  return `${base}?${params.join('&')}${hash !== undefined ? `#${hash}` : ''}`;
}

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
};

function queryOf(url: string, params?: unknown): Record<string, unknown> | null {
  const query: Record<string, unknown> = {};
  const search = url.split('?', 2)[1]?.split('#', 1)[0];
  for (const pair of search ? search.split('&') : []) {
    const [name, ...rest] = pair.split('=');
    if (name) query[safeDecode(name)] = safeDecode(rest.join('='));
  }
  if (params && typeof params === 'object') Object.assign(query, params);
  return Object.keys(query).length ? (redact(query) as Record<string, unknown>) : null;
}

// ── Formatting ────────────────────────────────────────────────────────────

function stringify(value: unknown): string {
  if (value === undefined) return '(none)';
  if (value === '') return '(empty)';
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    text = '[unprintable]';
  }
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}…(+${text.length - MAX_OUTPUT} chars)` : text;
}

/** A body as printed: JSON text is parsed first, so its fields are redacted too. */
function printableBody(body: unknown): unknown {
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return redact(JSON.parse(trimmed));
      } catch {
        // Not JSON after all: printed as text.
      }
    }
  }
  return redact(body);
}

type Entry = { id: number; method: string; url: string; start: number; retry: boolean };

const header = (kind: string, entry: Entry) =>
  `[API ${kind}] #${entry.id}${entry.retry ? ' (replayed after token refresh)' : ''}\n${entry.method} ${redactUrl(entry.url)}`;

function requestText(entry: Entry, parts: { headers: unknown; query: unknown; body: unknown; traceId?: string | null }): string {
  const lines = [header('REQUEST', entry), `Timestamp: ${new Date().toISOString()}`];
  if (parts.traceId) lines.push(`Request ID: ${parts.traceId}`);
  lines.push(`Headers: ${stringify(parts.headers)}`);
  if (parts.query) lines.push(`Query: ${stringify(parts.query)}`);
  lines.push(`Body: ${stringify(parts.body)}`);
  return lines.join('\n');
}

const durationOf = (entry: Entry, now: () => number) => `${Math.max(0, Math.round(now() - entry.start))}ms`;

function responseText(entry: Entry, now: () => number, parts: { status: number | string; traceId: string | null; body: unknown }): string {
  return [
    header('RESPONSE', entry), `Status: ${parts.status}`, `Duration: ${durationOf(entry, now)}`,
    `Trace ID: ${parts.traceId ?? '(none)'}`, `Timestamp: ${new Date().toISOString()}`, `Response: ${stringify(parts.body)}`,
  ].join('\n');
}

function errorText(entry: Entry, now: () => number, parts: {
  status: number | null; kind: string; code: string | null; message: string; serverCode: string | null;
  traceId: string | null; network: string | null; body: unknown;
}): string {
  const lines = [
    header('ERROR', entry), `Status: ${parts.status ?? '(no response)'}`, `Duration: ${durationOf(entry, now)}`,
    `Error: ${parts.kind}${parts.code ? ` (${parts.code})` : ''}`, `Message: ${parts.message}`,
  ];
  if (parts.serverCode) lines.push(`Server code: ${parts.serverCode}`);
  lines.push(`Trace ID: ${parts.traceId ?? '(none)'}`);
  if (parts.network) lines.push(`Network: ${parts.network}`);
  lines.push(`Response: ${stringify(parts.body)}`, `Timestamp: ${new Date().toISOString()}`);
  return lines.join('\n');
}

const headerValue = (headers: unknown, name: string): string | null => {
  const source = headers as { get?: (n: string) => unknown } & Record<string, unknown> | null;
  if (!source) return null;
  const value = typeof source.get === 'function' ? source.get(name) : source[name] ?? source[name.toLowerCase()];
  return typeof value === 'string' && value ? value : null;
};

/** The request/trace id a response carries (header or body), if any. */
function traceIdOf(headers: unknown, body: unknown): string | null {
  for (const name of ['x-request-id', 'x-trace-id', 'x-correlation-id']) {
    const value = headerValue(headers, name);
    if (value) return value;
  }
  const data = body as Record<string, unknown> | null;
  if (data && typeof data === 'object') {
    for (const field of ['trace_id', 'traceId', 'request_id', 'requestId']) {
      if (typeof data[field] === 'string') return data[field] as string;
    }
  }
  return null;
}

const serverCodeOf = (body: unknown): string | null => {
  const data = body as { code?: unknown; detail?: { code?: unknown } } | null;
  const code = data && typeof data === 'object' ? data.code ?? (typeof data.detail === 'object' ? data.detail?.code : undefined) : undefined;
  return typeof code === 'string' ? code : null;
};

function failureKind(status: number | null, code: string | null, name: string | null, message: string): string {
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || name === 'TimeoutError' || /timeout/i.test(message)) return 'TIMEOUT';
  if (code === 'ERR_CANCELED' || name === 'AbortError' || name === 'CanceledError') return 'CANCELED';
  if (status !== null) return status >= 500 ? 'HTTP_5XX' : 'HTTP_4XX';
  return 'NETWORK';
}

const NO_RESPONSE = 'no response (offline, DNS failure, TLS error or connection refused)';
const noResponse = (kind: string) => (kind === 'TIMEOUT' ? 'no response before the timeout' : kind === 'CANCELED' ? 'canceled by the app' : NO_RESPONSE);

// ── Axios ─────────────────────────────────────────────────────────────────

function fullUrl(config: InternalAxiosRequestConfig): string {
  const url = config.url ?? '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || !config.baseURL) return url;
  return `${config.baseURL.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
}

/**
 * Log every request this Axios instance sends (development only, once per
 * instance). Register it before the instance's own interceptors: request
 * interceptors run last-registered first, so the log sees the final headers;
 * response interceptors run in order, so it sees each answer before a 401
 * refresh replays the request (the replay is logged as its own request).
 */
export function installAxiosLogging(instance: Pick<AxiosInstance, 'interceptors'>, options: DevLogOptions = {}): void {
  if (!devLoggingEnabled()) return;
  const marked = instance as unknown as Record<symbol, boolean>;
  if (marked[AXIOS_MARK]) return;
  marked[AXIOS_MARK] = true;
  const sink = options.sink ?? ((text: string) => console.log(text));
  const now = options.now ?? defaultNow;
  const entries = new WeakMap<object, Entry>();

  instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    if (!devLoggingEnabled()) return config;
    try {
      const entry: Entry = {
        id: ++sequence, method: (config.method ?? 'get').toUpperCase(), url: fullUrl(config), start: now(),
        retry: (config as { _retried?: boolean })._retried === true,
      };
      entries.set(config, entry);
      const text = requestText(entry, {
        headers: redactHeaders(config.headers), query: queryOf(entry.url, config.params),
        body: config.data === undefined ? undefined : printableBody(config.data),
        traceId: headerValue(config.headers, 'X-Request-ID'),
      });
      defer(() => sink(text));
    } catch {
      // Logging never breaks a request.
    }
    return config;
  });

  instance.interceptors.response.use(
    (response: AxiosResponse) => {
      if (devLoggingEnabled()) {
        try {
          const entry = entries.get(response.config);
          if (entry) {
            const text = responseText(entry, now, {
              status: response.status, traceId: traceIdOf(response.headers, response.data), body: printableBody(response.data),
            });
            defer(() => sink(text));
          }
        } catch {
          // Logging never breaks a response.
        }
      }
      return response;
    },
    (error: AxiosError) => {
      if (devLoggingEnabled()) {
        try {
          const config = error?.config;
          const entry = (config && entries.get(config)) || {
            id: ++sequence, method: (config?.method ?? '?').toUpperCase(), url: config ? fullUrl(config) : '(unknown)',
            start: now(), retry: false,
          };
          const response = error?.response;
          const status = response?.status ?? null;
          const code = typeof error?.code === 'string' ? error.code : null;
          const message = String(error?.message ?? error);
          const kind = failureKind(status, code, error?.name ?? null, message);
          const text = errorText(entry, now, {
            status, kind, code, message,
            serverCode: serverCodeOf(response?.data), traceId: traceIdOf(response?.headers, response?.data),
            network: response ? null : noResponse(kind), body: response ? printableBody(response.data) : undefined,
          });
          defer(() => sink(text));
        } catch {
          // Logging never breaks error handling.
        }
      }
      return Promise.reject(error);
    },
  );
}

// ── fetch ─────────────────────────────────────────────────────────────────

type FetchTarget = { fetch: typeof fetch };

const LOGGED_URL = /^https?:\/\//i;  // file:, content:, data: and blob: reads are not API calls
// Address search: what the person types and the addresses it finds are
// personal, and no field name marks them.
const UNPRINTED = '[not printed: address search]';
const unprintedBody = (url: string) => /^https:\/\/places\.googleapis\.com\//i.test(url);

function textType(contentType: string | null): boolean {
  return !contentType || /json|text|xml|problem/i.test(contentType);
}

/**
 * Wrap the global fetch (development only, once): log each http(s) request
 * and its response or failure. The caller gets fetch's own promise, never a
 * new one; a response body is read from a clone, in the background.
 */
export function installFetchLogging(target: FetchTarget = globalThis as unknown as FetchTarget, options: DevLogOptions = {}): void {
  if (!devLoggingEnabled()) return;
  const current = target.fetch as typeof fetch & Record<symbol, unknown>;
  if (typeof current !== 'function' || current[FETCH_MARK]) return;
  const sink = options.sink ?? ((text: string) => console.log(text));
  const now = options.now ?? defaultNow;

  const wrapped = function logged(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const promise = Reflect.apply(current, target, [input, init]) as Promise<Response>;
    if (!devLoggingEnabled()) return promise;
    let entry: Entry | null = null;
    try {
      const request = typeof input === 'object' && input !== null && 'url' in input ? (input as Request) : null;
      const url = request ? request.url : String(input);
      if (LOGGED_URL.test(url)) {
        entry = { id: ++sequence, method: (init?.method ?? request?.method ?? 'GET').toUpperCase(), url, start: now(), retry: false };
        const text = requestText(entry, {
          headers: redactHeaders(init?.headers ?? request?.headers), query: queryOf(url),
          body: init?.body == null ? undefined : unprintedBody(url) ? UNPRINTED : printableBody(init.body),
        });
        defer(() => sink(text));
      }
    } catch {
      entry = null;
    }
    if (entry) {
      const logged = entry;
      promise.then(
        (response) => logFetchResponse(logged, response, sink, now),
        (error: unknown) => {
          try {
            const failure = error as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } };
            const message = String(failure?.message ?? error);
            const cause = failure?.cause ? ` (cause: ${failure.cause.code ?? failure.cause.message ?? 'unknown'})` : '';
            const kind = failureKind(null, failure?.code ?? null, failure?.name ?? null, message);
            const text = errorText(logged, now, {
              status: null, kind, code: failure?.code ?? failure?.name ?? null, message, serverCode: null, traceId: null,
              network: `${noResponse(kind)}${cause}`, body: undefined,
            });
            defer(() => sink(text));
          } catch {
            // Logging never breaks error handling.
          }
        },
      );
    }
    return promise;
  } as typeof fetch & Record<symbol, unknown>;
  wrapped[FETCH_MARK] = true;
  target.fetch = wrapped;
}

/** A fetch answer: a 2xx as a response, anything else as an error (fetch resolves both). */
function fetchResultText(entry: Entry, at: () => number, response: Response, body: unknown): string {
  const traceId = traceIdOf(response.headers, body);
  return response.ok
    ? responseText(entry, at, { status: response.status, traceId, body })
    : errorText(entry, at, {
      status: response.status, kind: failureKind(response.status, null, null, ''), code: null,
      message: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
      serverCode: serverCodeOf(body), traceId, network: null, body,
    });
}

function logFetchResponse(entry: Entry, response: Response, sink: (text: string) => void, now: () => number): void {
  try {
    // The duration runs to the response, not to reading its body for the log.
    const end = now();
    const at = () => end;
    const print = (body: unknown) => sink(fetchResultText(entry, at, response, body));
    const contentType = response.headers?.get?.('content-type') ?? null;
    const length = Number(response.headers?.get?.('content-length') ?? NaN);
    if (unprintedBody(entry.url)) {
      defer(() => print(UNPRINTED));
      return;
    }
    if (!textType(contentType) || length > MAX_FETCH_BODY_BYTES || typeof response.clone !== 'function') {
      defer(() => print(`[body not printed: ${contentType ?? 'unknown type'}${Number.isFinite(length) ? `, ${length} bytes` : ''}]`));
      return;
    }
    let copy: Response;
    try {
      copy = response.clone();
    } catch {
      defer(() => print('[body not readable]'));
      return;
    }
    copy.text().then(
      (text) => defer(() => print(text.length > MAX_FETCH_BODY_BYTES ? '[body too large to print]' : printableBody(text))),
      () => defer(() => print('[body not readable]')),
    );
  } catch {
    // Logging never breaks a response.
  }
}

// ── Native calls no JavaScript hook sees ──────────────────────────────────

/**
 * Log a native request (expo-file-system's downloadFileAsync) around `run`,
 * which it awaits and returns, or rethrows, unchanged. Development only.
 */
export async function trackNative<T>(
  method: string, url: string, headers: unknown, run: () => Promise<T>,
  describe: (result: T) => unknown = () => '(native call: no body)', options: DevLogOptions = {},
): Promise<T> {
  if (!devLoggingEnabled()) return run();
  const sink = options.sink ?? ((text: string) => console.log(text));
  const now = options.now ?? defaultNow;
  let entry: Entry | null = null;
  try {
    entry = { id: ++sequence, method: method.toUpperCase(), url, start: now(), retry: false };
    const text = requestText(entry, { headers: redactHeaders(headers), query: queryOf(url), body: undefined });
    defer(() => sink(text));
  } catch {
    entry = null;
  }
  try {
    const result = await run();
    if (entry) {
      try {
        const text = responseText(entry, now, {
          status: 'completed (native: no HTTP status exposed)', traceId: null, body: redact(describe(result)),
        });
        defer(() => sink(text));
      } catch {
        // Logging never breaks a response.
      }
    }
    return result;
  } catch (error) {
    if (entry) {
      try {
        const failure = error as { name?: string; message?: string; code?: string };
        const message = String(failure?.message ?? error);
        const text = errorText(entry, now, {
          status: null, kind: failureKind(null, failure?.code ?? null, failure?.name ?? null, message),
          code: failure?.code ?? null, message, serverCode: null, traceId: null, network: 'native request failed', body: undefined,
        });
        defer(() => sink(text));
      } catch {
        // Logging never breaks error handling.
      }
    }
    throw error;
  }
}
