import { AxiosError } from 'axios';

import { SessionExpiredError } from '@/api/client';
import { SERVER_CODE_MESSAGES } from '@/api/serverCodeMessages';

export interface ApiError {
  code: string;
  message: string;
  status: number | null;
  retryable: boolean;
  /** Backend correlation id (trace_id / X-Trace-Id) — include in support reports. */
  traceId?: string;
  /** Seconds to wait before retrying (Retry-After header / body hint on 429). */
  retryAfterSeconds?: number;
  /** 422 per-field validation messages, keyed by field name. */
  fieldErrors?: Record<string, string>;
  /** Backend machine code from the error envelope (`code`), e.g.
   *  ACCOUNT_LOCKED, ACCOUNT_EXISTS, REAUTH_REQUIRED, PIN_INVALID,
   *  TWO_FACTOR_INVALID, BOOKING_NOT_EDITABLE. Branch on this, never on text. */
  serverCode?: string;
  /** The body's `error` field when it is a machine code. Address calls put
   *  the real reason here (ADDRESS_NOT_VERIFIED…) and leave `code` generic. */
  errorCode?: string;
  /** ISO time an ACCOUNT_LOCKED lock ends. */
  lockedUntil?: string;
  /** PIN_INVALID: tries left before PIN_LOCKED. */
  attemptsRemaining?: number;
}

/** "15 minutes", "6 hours", "3 days" — the unit that reads naturally. */
export function waitText(seconds: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes < 60) return plural(minutes, 'minute');
  const hours = Math.ceil(seconds / 3600);
  if (hours < 48) return plural(hours, 'hour');
  return plural(Math.ceil(seconds / 86400), 'day');
}

/** Lock/limit text that includes the wait time when the backend sends one. */
function lockMessage(serverCode: string | undefined, retryAfter: number | undefined): string | undefined {
  const wait = retryAfter != null ? ` Try again in ${waitText(retryAfter)}.` : ' Please wait and try again.';
  switch (serverCode) {
    case 'ACCOUNT_LOCKED':
      return `Too many attempts.${wait}`;
    case 'PIN_LOCKED':
      return `Too many wrong PINs.${wait}`;
    case 'FACE_LOGIN_LOCKED':
      return `Too many face sign-in attempts.${wait}`;
    case 'FACE_UPDATE_LIMIT_REACHED':
      return `Too many failed face updates.${wait}`;
    case 'TWO_FACTOR_LOCKED':
      return SERVER_CODE_MESSAGES.TWO_FACTOR_LOCKED;
    default:
      return undefined;
  }
}

/** Backend sends trace_id in the error body and/or X-Trace-Id/X-Request-Id headers. */
function traceIdFrom(error: AxiosError): string | undefined {
  const data = error.response?.data as Record<string, unknown> | undefined;
  const fromBody = data?.trace_id ?? data?.traceId ?? data?.request_id ?? data?.requestId;
  if (typeof fromBody === 'string' && fromBody) return fromBody;
  const headers = error.response?.headers as Record<string, string> | undefined;
  const fromHeader = headers?.['x-trace-id'] ?? headers?.['x-request-id'] ?? headers?.['x-correlation-id'];
  return typeof fromHeader === 'string' && fromHeader ? fromHeader : undefined;
}

/** Retry-After: integer seconds or an HTTP-date. */
function retryAfterFrom(error: AxiosError): number | undefined {
  const headers = error.response?.headers as Record<string, string> | undefined;
  const raw = headers?.['retry-after'];
  if (!raw) return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs);
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}

/** Normalize a 422 `errors` payload — {field: msg}, {field: [msgs]} or
 *  [{field, message}] — into a flat field→message map. */
function fieldErrorsFrom(data: unknown): Record<string, string> | undefined {
  const errors = (data as Record<string, unknown> | undefined)?.errors
    ?? (data as Record<string, unknown> | undefined)?.field_errors;
  if (!errors) return undefined;
  const out: Record<string, string> = {};
  if (Array.isArray(errors)) {
    for (const e of errors) {
      const field = (e as Record<string, unknown>)?.field ?? (e as Record<string, unknown>)?.name;
      const msg = (e as Record<string, unknown>)?.message ?? (e as Record<string, unknown>)?.error;
      if (typeof field === 'string' && typeof msg === 'string') out[field] = msg;
    }
  } else if (typeof errors === 'object') {
    for (const [k, v] of Object.entries(errors as Record<string, unknown>)) {
      out[k] = Array.isArray(v) ? String(v[0] ?? '') : String(v);
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Normalize any thrown value into a safe, user-presentable ApiError.
 * Never leaks server internals or stack traces to the UI (OWASP A05/A09).
 *
 * Specific handling for:
 *  - 503 Service Unavailable (backend starting up / downstream down)
 *  - Network errors (no response — device offline / DNS failure)
 *  - Timeouts (ECONNABORTED)
 *  - 401 Unauthorized (session expired)
 *  - 429 Rate limited
 *  - 5xx server errors
 *  - 4xx request errors
 */
export function toApiError(error: unknown): ApiError {
  const base = baseApiError(error);
  if (!(error instanceof AxiosError) || !error.response) return base;

  const data = error.response.data as Record<string, unknown> | undefined;
  const details = (data?.details && typeof data.details === 'object' && !Array.isArray(data.details)
    ? data.details
    : undefined) as Record<string, unknown> | undefined;
  const pick = (k: string) => data?.[k] ?? details?.[k];

  const serverCode = typeof data?.code === 'string' ? data.code : undefined;
  const errorCode = typeof data?.error === 'string' && /^[A-Z][A-Z0-9_]+$/.test(data.error) ? data.error : undefined;
  const lockedUntil = typeof pick('locked_until') === 'string' ? (pick('locked_until') as string) : undefined;
  const attempts = pick('attempts_remaining');
  const attemptsRemaining = typeof attempts === 'number' ? attempts : undefined;
  const retryAfterSeconds =
    base.retryAfterSeconds ?? (typeof pick('retry_after') === 'number' ? (pick('retry_after') as number) : undefined);

  let message = base.message;
  const lock = lockMessage(serverCode, retryAfterSeconds);
  if (lock) message = lock;
  else if (serverCode && SERVER_CODE_MESSAGES[serverCode]) {
    message = SERVER_CODE_MESSAGES[serverCode];
    if (serverCode === 'PIN_INVALID' && attemptsRemaining != null) {
      message = `Incorrect PIN. ${attemptsRemaining} ${attemptsRemaining === 1 ? 'try' : 'tries'} left.`;
    }
  }

  return {
    ...base,
    // 403 REAUTH_REQUIRED is its own category: the caller must ask for the PIN.
    code: serverCode === 'REAUTH_REQUIRED' ? 'REAUTH_REQUIRED' : base.code,
    message,
    serverCode,
    errorCode,
    lockedUntil,
    attemptsRemaining,
    retryAfterSeconds,
  };
}

/** Errors already logged in dev (see baseApiError). */
const loggedErrors = new WeakSet<object>();

function baseApiError(error: unknown): ApiError {
  // Refresh token missing/rejected — session is over, not retryable.
  if (error instanceof SessionExpiredError) {
    return {
      code: 'UNAUTHORIZED',
      message: 'Your session expired. Please log in again.',
      status: 401,
      retryable: false,
    };
  }

  if (error instanceof AxiosError) {
    const status = error.response?.status ?? null;
    const traceId = traceIdFrom(error);
    const data = error.response?.data as Record<string, unknown> | undefined;
    const serverMsg = (typeof data?.message === 'string' ? data.message : undefined)
      ?? (typeof data?.error === 'string' ? data.error : undefined);

    // Log the full request context so 404s / unexpected failures can be
    // diagnosed from Metro logs (method + URL + status + server body) —
    // once per error: screens map the same query error on every render.
    if (__DEV__ && !loggedErrors.has(error)) {
      loggedErrors.add(error);
      const url = `${error.config?.baseURL ?? ''}${error.config?.url ?? ''}`;
      console.warn(
        `[API] ${error.config?.method?.toUpperCase() ?? '?'} ${url} → ${status ?? 'no-response'}`,
        traceId ? `trace=${traceId}` : undefined,
        typeof data === 'object' ? JSON.stringify(data) : data,
      );
    }


    // ── Timeout ────────────────────────────────────────────────────
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return {
        code: 'TIMEOUT',
        message: 'Request timed out. Please try again.',
        status,
        retryable: true,
        traceId,
      };
    }

    // ── No response (network / DNS / connection refused) ──────────
    if (!error.response) {
      return {
        code: 'NETWORK',
        message: 'Cannot reach the server. Check your internet connection and try again.',
        status: null,
        retryable: true,
      };
    }

    // ── 503 Service Unavailable ────────────────────────────────────
    if (status === 503) {
      return {
        code: 'SERVICE_UNAVAILABLE',
        // 503 = the BFF or a service behind it (documents, Regula) is down
        // or restarting — not something the user did.
        message: 'Our service is busy right now. Please try again in a moment.',
        status,
        retryable: true,
        traceId,
      };
    }

    // ── 401 Unauthorized ───────────────────────────────────────────
    if (status === 401) {
      // 401 from an auth attempt (login/register/OTP) means bad credentials,
      // NOT an expired session — show a credential error instead.
      const url = error.config?.url ?? '';
      const isAuthAttempt = ['/auth/login', '/auth/register', '/auth/verify-otp', '/auth/2fa/verify', '/auth/face-login'].some((p) =>
        url.endsWith(p),
      );
      if (isAuthAttempt) {
        return {
          code: 'INVALID_CREDENTIALS',
          message: serverMsg
            ?? (url.endsWith('/auth/login')
              ? 'Invalid email/phone or password. Please try again.'
              : 'Authentication failed. Please check your details and try again.'),
          status,
          retryable: false,
          traceId,
        };
      }
      return {
        code: 'UNAUTHORIZED',
        message: 'Your session expired. Please log in again.',
        status,
        retryable: false,
        traceId,
      };
    }

    // ── 429 Rate Limited ───────────────────────────────────────────
    if (status === 429) {
      const retryAfterSeconds = retryAfterFrom(error)
        ?? (typeof data?.retry_after === 'number' ? data.retry_after : undefined)
        ?? (typeof data?.retryAfter === 'number' ? data.retryAfter : undefined);
      return {
        code: 'RATE_LIMITED',
        message: 'Too many attempts. Please wait and try again.',
        status,
        retryable: true,
        traceId,
        retryAfterSeconds,
      };
    }

    // ── 413 Payload Too Large (>20 MB per backend contract) ────────
    if (status === 413) {
      return {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'The captured image is too large to upload. Please retake it in good light and try again.',
        status,
        retryable: false,
        traceId,
      };
    }

    // ── 422 Unprocessable — per-field validation errors ────────────
    if (status === 422) {
      return {
        code: 'VALIDATION',
        message: serverMsg ?? 'Please check the highlighted fields and try again.',
        status,
        retryable: false,
        traceId,
        fieldErrors: fieldErrorsFrom(data),
      };
    }

    // ── 5xx Server errors (excluding 503 handled above) ────────────
    if (status !== null && status >= 500) {
      return {
        code: 'SERVER',
        message: 'Something went wrong on our side. Please retry.',
        status,
        retryable: true,
        traceId,
      };
    }

    // ── 404 Not Found ──────────────────────────────────────────────
    // During sign-up it usually means the registration session expired;
    // anywhere else, the item was removed.
    if (status === 404) {
      const authFlow = (error.config?.url ?? '').includes('/auth/');
      return {
        code: 'NOT_FOUND',
        message: serverMsg
          ?? (authFlow
            ? 'Your sign-up session expired. Please start again.'
            : "We couldn't find that. It may have been removed."),
        status,
        retryable: false,
        traceId,
      };
    }

    // ── 409 Conflict ───────────────────────────────────────────────
    // Common cause: email/phone already registered with another account.
    if (status === 409) {
      return {
        code: 'CONFLICT',
        message: serverMsg
          ?? 'An account with these details already exists. Please log in or use different details.',
        status,
        retryable: false,
        traceId,
      };
    }

    // ── 4xx Request errors ─────────────────────────────────────────
    if (serverMsg) {
      return {
        code: 'REQUEST',
        message: serverMsg,
        status,
        retryable: false,
        traceId,
      };
    }
    return {
      code: 'REQUEST',
      message: status === 403 ? "You don't have access to this." : 'Request failed. Please check your input.',
      status,
      retryable: false,
      traceId,
    };
  }

  // ── Plain Error (e.g., from mock API or manual throw) ──────────────
  if (error instanceof Error) {
    return {
      code: 'UNKNOWN',
      message: error.message,
      status: null,
      retryable: true,
    };
  }

  return {
    code: 'UNKNOWN',
    message: 'Unexpected error. Please try again.',
    status: null,
    retryable: true,
  };
}

/** Returns true if the error is a 503 or network error (backend unreachable). */
export function isBackendDown(error: unknown): boolean {
  const apiError = toApiError(error);
  return apiError.code === 'SERVICE_UNAVAILABLE' || apiError.code === 'NETWORK';
}
