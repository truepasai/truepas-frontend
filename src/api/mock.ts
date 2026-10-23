import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';

import { clearReauthToken, peekReauthToken, setReauthToken, takeReauthToken } from '@/services/reauth';
import type {
    AccountDetailsRequest,
    Address,
    AddressInput,
    AccountDetailsResponse,
    ActivityItem,
    ActivityLogItem,
    AppPreferences,
    AuthSession,
    CreateReservationRequest,
    DataExport,
    DocumentImagePart,
    DocumentImages,
    DocumentReasonCode,
    DocumentUploadUrls,
    FaceLoginPurpose,
    FaceLoginResult,
    FaceLoginStartResponse,
    LoginResult,
    MerchantSummary,
    NotificationCount,
    NotificationPreferences,
    NotificationType,
    PushDevice,
    ResetPinRequest,
    RevokeSessionsResponse,
    SecurityScore,
    SupportChannels,
    SupportedDocumentType,
    TwoFactorEnableResponse,
    TwoFactorMethod,
    TwoFactorStatusResponse,
    UpdateReservationRequest,
    UserStats,
    PinScope,
    VerifyPinResponse,
    AddDocumentRequest,
    AddFamilyMemberRequest,
    AuthResponse,
    BiometricConsentRequest,
    Booking,
    ChangePasswordRequest,
    ChangePinRequest,
    DeleteAccountRequest,
    FaceEnrollRequest,
    FaceResponse,
    FaceUpdateRequest,
    FamilyMember,
    ForgotPasswordRequest,
    IdentityDocument,
    IdentitySummary,
    LivenessChallenge,
    LivenessChallengeResponse,
    LivenessEvidenceRequest,
    LivenessEvidenceResponse,
    LivenessFinalizeResponse,
    LoginRequest,
    LogoutRequest,
    Notification,
    OkResponse,
    ProfilePictureResponse,
    RegisterRequest,
    RegisterResponse,
    ResetPasswordRequest,
    UpdateProfileRequest,
    User,
    VerificationSession,
    VerificationSessionRequest,
    VerifyDocumentRequest,
    VerifyDocumentResponse,
    VerifyOtpRequest,
    VerifyOtpResponse
} from '@/types/domain';

import bookingsData from './data/bookings.json';
import documentsData from './data/documents.json';
import familyData from './data/family.json';
import identitySummaryData from './data/identitySummary.json';
import merchantsData from './data/merchants.json';
import userData from './data/user.json';

/**
 * Mock API layer — mirrors the REST contract with realistic latency.
 * Data is sourced from JSON fixtures in `src/api/data/` (not hardcoded here),
 * so it maps 1:1 onto the real backend JSON response shape.
 *
 * Write operations mutate an in-memory copy of the fixtures so the whole
 * app flow (add/edit/delete) works end-to-end without a backend. On app
 * restart, state resets to the original JSON fixtures.
 *
 * The function signatures here define the API contract — `endpoints.ts`
 * implements the same signatures against the real backend.
 */
const LATENCY_MS = 450;

function respond<T>(data: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(data), LATENCY_MS));
}

function fail(message: string): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), LATENCY_MS));
}

/** A failure shaped like an axios HTTP error, for flows that branch on the
 *  status or the body (404 → add form, 400 → "Did you mean…?"). */
function failHttp(status: number, data: Record<string, unknown>, headers: Record<string, string> = {}): Promise<never> {
  const response = {
    status,
    statusText: '',
    data,
    headers,
    config: { headers: new AxiosHeaders() },
  } as AxiosResponse;
  const error = new AxiosError(String(data.message ?? data.error ?? 'Request failed'), String(status), response.config, null, response);
  return new Promise((_, reject) => setTimeout(() => reject(error), LATENCY_MS));
}

let uid = 100;
const nextId = (prefix: string) => `${prefix}${uid++}`;

// ── In-memory state (initialized from JSON fixtures) ──────────────────
let user: User = { ...(userData as User) };
let userPassword = 'password123';
/** Initial mock PIN — surfaced on the Security screen as a dev hint. */
export const MOCK_PIN = '1234';
let userPin = MOCK_PIN;
let biometricConsentAccepted = false;

const identitySummary: IdentitySummary = identitySummaryData as IdentitySummary;
let documents: IdentityDocument[] = [...(documentsData as IdentityDocument[])];
let family: FamilyMember[] = (familyData as FamilyMember[]).map((f) => ({
  ...f,
  permissions: { independentCheckIn: false, notifyOnCheckIn: true },
  createdAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
  faceEnrolled: false,
}));
let bookings: Booking[] = bookingsData as Booking[];
const merchants: MerchantSummary[] = merchantsData as MerchantSummary[];
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
let notifications: Notification[] = [
  { id: 'n1', title: 'Face enrolled', body: 'Your face is set up for check-in.', read: false, createdAt: minutesAgo(30), type: 'identity', data: { type: 'identity' } },
  { id: 'n2', title: 'Maya added to your family', body: 'Finish her face scan to check in together.', read: false, createdAt: minutesAgo(180), type: 'family', data: { type: 'family', personId: 'f1' } },
  { id: 'n3', title: 'Reservation added', body: 'Hilton Garden Inn, Oct 12.', read: true, createdAt: minutesAgo(1440), type: 'booking', data: { type: 'booking', bookingId: 'b9' } },
  { id: 'n4', title: 'PIN changed', body: 'Your PIN was changed. If this wasn\'t you, contact support.', read: true, createdAt: minutesAgo(4320), type: 'account', data: { type: 'account' } },
];

// ── Oct 2026 backend features (in-memory) ─────────────────────────────
let twoFactor: { enabled: boolean; method: TwoFactorMethod | null } = { enabled: false, method: null };
let pendingTwoFactorMethod: TwoFactorMethod | null = null;
let sessions: AuthSession[] = [
  { id: 's1', device: 'This phone', platform: 'android', appVersion: '1.0.0', createdAt: minutesAgo(2880), lastActiveAt: minutesAgo(0), current: true },
  { id: 's2', device: 'iPad Air', platform: 'ios', appVersion: '1.0.0', createdAt: minutesAgo(20160), lastActiveAt: minutesAgo(4320), current: false },
  { id: 's3', device: null, platform: null, appVersion: null, createdAt: minutesAgo(60000), lastActiveAt: minutesAgo(30000), current: false },
];
let notificationPrefs: NotificationPreferences = { checkin: true, family: true, security: true, document: true };
let appPrefs: AppPreferences = { language: 'en', region: null, faceCheckInEnabled: true, shareAnalytics: false };
let pushDevices: PushDevice[] = [];
const verificationLiveness = new Map<string, string | undefined>();
let dataExport: DataExport | null = null;
let address: Address | null = null;
let addressUpdatedAt = 0;
const ADDRESS_COOLDOWN_S = 15 * 86_400;

/** Mimics Smarty: "nowhere" fails with no suggestion, ZIP 00000 fails with
 *  one, anything else comes back standardized (title case, ZIP+4). */
function checkMockAddress(input: AddressInput): Promise<never> | Address {
  if (input.country === 'US') {
    if (/nowhere/i.test(input.line1)) {
      return failHttp(400, {
        error: 'ADDRESS_NOT_VERIFIED',
        message: 'The address could not be verified. Please check your street, city, state, and ZIP code and try again.',
        issues: ['Street address could not be verified'],
        suggestion: null,
        fields: ['address'],
      });
    }
    if (input.postal_code === '00000') {
      return failHttp(400, {
        error: 'ADDRESS_NOT_VERIFIED',
        message: 'The address could not be verified. Please check your street, city, state, and ZIP code and try again.',
        issues: ['City name does not match postal code'],
        suggestion: { line1: '1600 Pennsylvania Ave NW', city: 'Washington', state: 'DC', postal_code: '20500-0005' },
        fields: ['address'],
      });
    }
  }
  const title = (s: string) => s.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    id: address?.id ?? nextId('addr'),
    line1: input.country === 'US' ? title(input.line1) : input.line1.trim(),
    line2: input.line2?.trim() || null,
    city: input.country === 'US' ? title(input.city) : input.city.trim(),
    state: input.country === 'US' ? input.state.trim().toUpperCase() : input.state.trim(),
    postal_code: input.country === 'US' && /^\d{5}$/.test(input.postal_code) ? `${input.postal_code}-0001` : input.postal_code,
    country: input.country,
  };
}

const SUPPORTED_TYPES: SupportedDocumentType[] = [
  { type: 'passport', label: 'Passport', selfieRequired: true, allowedForMinors: true, allowedForAdults: true, minAge: null, maxAge: null },
  { type: 'idCard', label: 'ID card', selfieRequired: true, allowedForMinors: true, allowedForAdults: true, minAge: null, maxAge: null },
  { type: 'drivingLicense', label: "Driver's license", selfieRequired: true, allowedForMinors: true, allowedForAdults: true, minAge: 16, maxAge: null },
  { type: 'greenCard', label: 'Green card', selfieRequired: true, allowedForMinors: true, allowedForAdults: true, minAge: null, maxAge: null },
  { type: 'usVisa', label: 'U.S. visa', selfieRequired: true, allowedForMinors: true, allowedForAdults: true, minAge: null, maxAge: null },
  { type: 'birthCertificate', label: 'Birth certificate', selfieRequired: false, allowedForMinors: true, allowedForAdults: false, minAge: null, maxAge: 17 },
];

const REASON_MESSAGES: Record<DocumentReasonCode, string> = {
  DOCUMENT_PROCESSING_ERROR: "We couldn't read this document. Retake the photos in good light.",
  AUTHENTICITY_FAILED: 'This document did not pass our security checks. Try another document.',
  DOCUMENT_TYPE_MISMATCH: 'The document does not look like the type you selected. Check the type and retake it.',
  DOCUMENT_UNREADABLE: 'Some details on the document could not be read. Retake the photos in good light.',
  NO_PORTRAIT_IN_DOCUMENT: "We couldn't find a photo of you on this document. Use a document that shows your face.",
  FACE_NOT_ENROLLED: 'Verify this document with a live selfie, or set up the face first.',
  DOCUMENT_FACE_MISMATCH: 'The photo on this document does not match your enrolled face. Make sure it is your own document.',
  PROFILE_MISMATCH: 'The details on this document do not match your profile. Check the document or update your profile.',
  DOCUMENT_CHECKS_INCONCLUSIVE: "We couldn't confirm this document automatically. Retake the photos in good light or try another document.",
};

function pushNotification(title: string, body: string, type: NotificationType, data: Notification['data']) {
  notifications = [{ id: nextId('n'), title, body, read: false, createdAt: new Date().toISOString(), type, data }, ...notifications];
}

/** Account activity derived from the in-memory state, newest first. */
function accountActivity(): ActivityItem[] {
  const out: ActivityItem[] = [];
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  for (const d of documents.filter((x) => !x.personId || x.personId === user.id)) {
    const at = d.verifiedAt ?? `${d.addedAt}T10:00:00Z`;
    out.push({
      id: `doc-${d.id}`,
      type: d.status === 'verified' ? 'document_verified' : d.status === 'failed' ? 'document_failed' : 'document_added',
      title: `${d.label} ${d.status === 'verified' ? 'verified' : d.status === 'failed' ? 'failed' : 'added'}`,
      occurredAt: at,
      timestamp: fmt(at),
      tone: d.status === 'verified' ? 'success' : d.status === 'failed' ? 'warning' : 'neutral',
      ref: { documentId: d.id },
    });
  }
  for (const f of family) {
    const at = f.createdAt ?? minutesAgo(600);
    out.push({ id: `fam-${f.id}`, type: 'family_member_added', title: `${f.name.split(' ')[0]} added to family`, occurredAt: at, timestamp: fmt(at), tone: 'neutral', ref: { personId: f.id } });
  }
  if (user.faceEnrolled) {
    const at = user.faceEnrolledAt ?? minutesAgo(9000);
    out.push({ id: 'face', type: 'face_enrolled', title: 'Face enrolled', occurredAt: at, timestamp: fmt(at), tone: 'success' });
  }
  return out.sort((a, b) => (b.occurredAt ?? '').localeCompare(a.occurredAt ?? '')).slice(0, 20);
}

export const mockUser: User = user;

function authResponse(): AuthResponse {
  return {
    user,
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
  };
}

function ageFromDob(dob: string): number {
  const us = dob.match(/^(\d{2})\s*\/\s*(\d{2})\s*\/\s*(\d{4})$/);
  const iso = dob.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!us && !iso) return 0;
  const [year, month, day] = us ? [us[3], us[1], us[2]] : [iso![1], iso![2], iso![3]];
  const birth = new Date(Number(year), Number(month) - 1, Number(day));
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export const mockApi = {
  // ── Reads ────────────────────────────────────────────────────────────
  getUser: () => respond(user),
  getIdentitySummary: () => respond({ ...identitySummary, activity: [...identitySummary.activity, ...accountActivity()] }),
  getDocuments: (personId?: string) =>
    respond(
      personId
        ? documents.filter((d) => d.personId === personId)
        : // Self call: only the account owner's documents — family members'
          // documents (tagged with their personId) must not leak in here.
          documents.filter((d) => !d.personId || d.personId === user.id),
    ),
  getDocument: (id: string) => respond(documents.find((d) => d.id === id) ?? null),
  getFamily: () => respond(family),
  getFamilyMember: (id: string) => respond(family.find((f) => f.id === id) ?? null),
  getFamilyActivity: (id: string): Promise<ActivityLogItem[]> => {
    const m = family.find((f) => f.id === id);
    if (!m) return respond([]);
    const out: ActivityLogItem[] = [];
    for (const d of documents.filter((x) => x.personId === id)) {
      out.push({
        id: `doc-${d.id}`,
        type: d.status === 'verified' ? 'document_verified' : d.status === 'failed' ? 'document_failed' : 'document_added',
        title: `${d.label} ${d.status === 'verified' ? 'verified' : d.status === 'failed' ? 'failed' : 'added'}`,
        date: d.verifiedAt ?? `${d.addedAt}T10:00:00Z`,
        tone: d.status === 'verified' ? 'success' : d.status === 'failed' ? 'warning' : 'neutral',
        ref: { documentId: d.id, personId: id },
      });
    }
    if (m.faceEnrolled) {
      out.push({ id: `face-${id}`, type: 'family_face_enrolled', title: 'Face enrolled', date: m.faceEnrolledAt ?? minutesAgo(120), tone: 'success', ref: { personId: id } });
    }
    out.push({ id: `added-${id}`, type: 'family_member_added', title: 'Added to your family', date: m.createdAt ?? minutesAgo(600), tone: 'neutral', ref: { personId: id } });
    return respond(out.sort((a, b) => b.date.localeCompare(a.date)));
  },
  getBookings: () => respond(bookings),
  getBooking: (id: string) => respond(bookings.find((b) => b.id === id) ?? null),
  getNotifications: (params?: { limit?: number; offset?: number; unreadOnly?: boolean; type?: NotificationType }) => {
    const list = notifications.filter(
      (n) => (!params?.unreadOnly || !n.read) && (!params?.type || n.type === params.type),
    );
    const offset = params?.offset ?? 0;
    return respond(list.slice(offset, offset + (params?.limit ?? 50)));
  },
  getNotificationCount: (type?: NotificationType): Promise<NotificationCount> => {
    const list = notifications.filter((n) => !type || n.type === type);
    return respond({ total: list.length, unread: list.filter((n) => !n.read).length });
  },
  markNotificationRead: (id: string): Promise<OkResponse> => {
    notifications = notifications.map((n) => (n.id === id ? { ...n, read: true, readAt: new Date().toISOString() } : n));
    return respond({ ok: true });
  },
  markNotificationsRead: (ids: string[]): Promise<OkResponse> => {
    notifications = notifications.map((n) => (ids.includes(n.id) ? { ...n, read: true, readAt: new Date().toISOString() } : n));
    return respond({ ok: true });
  },
  markAllNotificationsRead: (): Promise<OkResponse> => {
    notifications = notifications.map((n) => ({ ...n, read: true, readAt: n.readAt ?? new Date().toISOString() }));
    return respond({ ok: true });
  },
  getNotificationPreferences: () => respond(notificationPrefs),
  updateNotificationPreferences: (patch: Partial<NotificationPreferences>) => {
    notificationPrefs = { ...notificationPrefs, ...patch };
    return respond(notificationPrefs);
  },
  registerPushDevice: (pushToken: string, platform: 'ios' | 'android'): Promise<PushDevice> => {
    const existing = pushDevices.find((d) => d.id === `push-${pushToken.slice(-6)}`);
    const device = existing ?? { id: `push-${pushToken.slice(-6)}`, platform, createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() };
    pushDevices = [...pushDevices.filter((d) => d.id !== device.id), { ...device, lastSeenAt: new Date().toISOString() }];
    return respond(device);
  },
  getPushDevices: () => respond(pushDevices),
  deletePushDevice: (id: string): Promise<OkResponse> => {
    pushDevices = pushDevices.filter((d) => d.id !== id);
    return respond({ ok: true });
  },

  // ── Home / profile / settings data ───────────────────────────────────
  getAccountActivity: () => respond(accountActivity()),
  getSecurityScore: (): Promise<SecurityScore> => {
    const docs = documents.filter((d) => !d.personId || d.personId === user.id);
    const verified = docs.some((d) => d.status === 'verified');
    const suggestions: SecurityScore['suggestions'] = [];
    if (!user.faceEnrolled) suggestions.push({ id: 'enroll_face', title: 'Set up your face', points: 30 });
    if (docs.length === 0) suggestions.push({ id: 'add_document', title: 'Add an ID document', points: 20 });
    else if (!verified) suggestions.push({ id: 'verify_document', title: 'Verify your document', points: 15 });
    if (!twoFactor.enabled) suggestions.push({ id: 'enable_2fa', title: 'Turn on 2-step sign-in', points: 8 });
    if (sessions.length > 2) suggestions.push({ id: 'review_sessions', title: 'Review signed-in devices', points: 4 });
    const lost = suggestions.reduce((n, x) => n + x.points, 0);
    return respond({ score: Math.max(0, 100 - lost), identityStrength: Math.max(0, 100 - lost + (twoFactor.enabled ? 0 : 8)), suggestions });
  },
  getUserStats: (year: number): Promise<UserStats> => {
    const done = bookings.filter((b) => b.status === 'completed' && new Date(b.checkIn).getFullYear() === year);
    return respond({
      year,
      checkIns: done.length,
      cities: new Set(done.map((b) => b.location)).size,
      avgCheckInMs: done.length ? 950 : null,
      minutesSaved: done.length * 2,
    });
  },
  getPreferences: () => respond(appPrefs),
  updatePreferences: (patch: Partial<AppPreferences>) => {
    appPrefs = { ...appPrefs, ...patch };
    return respond(appPrefs);
  },
  getSupportChannels: (): Promise<SupportChannels> =>
    respond({ email: 'support@truepas.com', phone: null, hours: null, chatUrl: null }),
  requestDataExport: (): Promise<DataExport> => {
    dataExport = dataExport ?? { exportId: nextId('exp'), status: 'pending', readyAt: null, expiresAt: null };
    return respond(dataExport);
  },
  getDataExport: (exportId: string): Promise<DataExport> =>
    respond(dataExport && dataExport.exportId === exportId ? dataExport : { exportId, status: 'expired' }),

  // ── Auth ─────────────────────────────────────────────────────────────
  login: (payload: LoginRequest): Promise<LoginResult> => {
    if (!payload.identifier || !payload.password) {
      return fail('Invalid credentials');
    }
    // 2-step sign-in: on when turned on in Security, or for any identifier
    // containing "2fa" (lets the code screen be tried without set-up).
    if (twoFactor.enabled || payload.identifier.includes('2fa')) {
      return respond({ nextStep: 'verify2fa', challengeId: nextId('ch'), method: twoFactor.method ?? 'email' });
    }
    return respond(authResponse());
  },
  verifyTwoFactor: (payload: { challengeId: string; code: string }): Promise<AuthResponse> => {
    if (!/^\d{6}$/.test(payload.code)) return fail('That code is wrong or has expired. Try again.');
    return respond(authResponse());
  },
  enableTwoFactor: (method: TwoFactorMethod): Promise<TwoFactorEnableResponse> => {
    // Remember the method being set up; an existing working method stays on.
    pendingTwoFactorMethod = method;
    return respond({
      method,
      challengeId: nextId('ch'),
      nextStep: 'confirm',
      ...(method === 'totp'
        ? {
            secret: 'JBSWY3DPEHPK3PXP',
            otpauthUri: `otpauth://totp/TruePas%3A${encodeURIComponent(user.email)}?secret=JBSWY3DPEHPK3PXP&issuer=TruePas&digits=6&period=30`,
          }
        : {}),
    });
  },
  confirmTwoFactor: (payload: { challengeId: string; code: string }): Promise<TwoFactorStatusResponse> => {
    if (!/^\d{6}$/.test(payload.code)) return fail('That code is wrong or has expired. Try again.');
    twoFactor = { enabled: true, method: pendingTwoFactorMethod ?? twoFactor.method ?? 'email' };
    pendingTwoFactorMethod = null;
    user = { ...user, twoFactorEnabled: true, twoFactorMethod: twoFactor.method };
    return respond({ ok: true, twoFactorEnabled: true, method: twoFactor.method ?? 'email' });
  },
  disableTwoFactor: (pin: string): Promise<TwoFactorStatusResponse> => {
    if (pin !== userPin) return fail('Incorrect PIN.');
    twoFactor = { enabled: false, method: null };
    user = { ...user, twoFactorEnabled: false, twoFactorMethod: null };
    return respond({ ok: true, twoFactorEnabled: false });
  },
  getSessions: () => respond(sessions),
  revokeSession: (id: string): Promise<RevokeSessionsResponse> => {
    const before = sessions.length;
    sessions = sessions.filter((x) => x.id !== id);
    return respond({ ok: true, revoked: before - sessions.length });
  },
  revokeOtherSessions: (): Promise<RevokeSessionsResponse> => {
    const before = sessions.length;
    sessions = sessions.filter((x) => x.current);
    return respond({ ok: true, revoked: before - sessions.length });
  },
  startFaceLogin: (payload: { identifier: string; purpose: FaceLoginPurpose }): Promise<FaceLoginStartResponse> =>
    respond({ nextStep: 'face', preauthToken: 'mock-preauth', expiresIn: 300, purpose: payload.purpose }),
  faceLogin: (_payload: { preauthToken: string; livenessSessionId: string; sessionToken: string }): Promise<FaceLoginResult> =>
    respond(authResponse()),
  resetPin: (payload: ResetPinRequest): Promise<OkResponse> => {
    if (!/^\d{4,6}$/.test(payload.newPin)) return fail('PIN must be 4–6 digits');
    userPin = payload.newPin;
    return respond({ ok: true, message: 'PIN reset' });
  },
  register: (payload: RegisterRequest): Promise<RegisterResponse> => {
    user = { ...user, phone: `${payload.countryCode} ${payload.phone}` };
    return respond({
      ok: true,
      message: 'Verification code sent',
      registrationId: nextId('reg'),
      nextStep: 'verifyPhone',
    });
  },
  verifyOtp: (payload: VerifyOtpRequest): Promise<VerifyOtpResponse> => {
    if (payload.otp.length !== 6 && payload.otp.length !== 4) {
      return fail('Invalid OTP');
    }
    if (payload.purpose === 'phone') {
      return respond({
        ok: true,
        message: 'Phone verified',
        registrationToken: 'mock-registration-token',
        nextStep: 'accountDetails',
      });
    }
    if (payload.purpose === 'email') {
      // Email verification during registration returns full AuthResponse fields
      const auth = authResponse();
      return respond({
        ok: true,
        message: 'Email verified',
        nextStep: 'verifyEmail',
        user: auth.user,
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
      });
    }
    // password_reset
    return respond({
      ok: true,
      message: 'OTP verified',
      nextStep: 'reset',
    });
  },
  completeAccountDetails: (payload: AccountDetailsRequest): Promise<AccountDetailsResponse> => {
    user = {
      ...user,
      fullName: payload.fullName,
      email: payload.email,
      faceEnrolled: false,
      biometricConsentAt: null,
    };
    userPassword = payload.password;
    userPin = payload.pin;
    return respond({
      ok: true,
      message: 'Email verification code sent',
      nextStep: 'verifyEmail',
    });
  },
  forgotPassword: (_payload: ForgotPasswordRequest): Promise<OkResponse> => {
    return respond({ ok: true, message: 'If the account exists, a verification code was sent' });
  },
  resetPassword: (payload: ResetPasswordRequest): Promise<OkResponse> => {
    userPassword = payload.newPassword;
    return respond({ ok: true, message: 'Password reset' });
  },
  changePassword: (payload: ChangePasswordRequest): Promise<OkResponse> => {
    if (payload.currentPassword !== userPassword) {
      return fail('Current password is incorrect');
    }
    if (payload.newPassword === payload.currentPassword) {
      return fail('New password must be different from your current password');
    }
    userPassword = payload.newPassword;
    return respond({ ok: true, message: 'Password changed' });
  },
  changePin: (payload: ChangePinRequest): Promise<OkResponse> => {
    if (payload.currentPin !== userPin) {
      return fail('Current PIN is incorrect');
    }
    if (payload.newPin === payload.currentPin) {
      return fail('New PIN must be different from your current PIN');
    }
    userPin = payload.newPin;
    user = { ...user, pinChangedAt: new Date().toISOString() };
    return respond({ ok: true, message: 'PIN changed' });
  },
  verifyPin: (pin: string, scope?: PinScope): Promise<VerifyPinResponse> => {
    if (pin !== userPin) {
      return fail('Incorrect PIN');
    }
    setReauthToken('mock-reauth', 300);
    return respond({ ok: true, reauthToken: 'mock-reauth', scope: scope ?? 'face_update', expiresIn: 300 });
  },
  logout: (_payload: LogoutRequest): Promise<OkResponse> => {
    return respond({ ok: true });
  },
  deleteAccount: (payload: DeleteAccountRequest): Promise<OkResponse> => {
    if (payload.confirmation !== 'DELETE') {
      return fail('Confirmation text does not match');
    }
    if (payload.pin !== userPin) {
      return fail('Incorrect PIN');
    }
    return respond({ ok: true, message: 'Account deleted' });
  },

  // ── Profile ──────────────────────────────────────────────────────────
  updateProfile: (payload: UpdateProfileRequest): Promise<User> => {
    user = { ...user, ...payload };
    return respond(user);
  },

  // ── Address ──────────────────────────────────────────────────────────
  getAddress: (): Promise<Address | null> => respond(address),
  createAddress: (payload: AddressInput): Promise<Address> => {
    if (address) return failHttp(409, { error: 'ADDRESS_ALREADY_EXISTS', message: 'An address already exists. Update it instead.' });
    const checked = checkMockAddress(payload);
    if (checked instanceof Promise) return checked;
    address = checked;
    return respond(address);
  },
  updateAddress: (payload: AddressInput): Promise<Address> => {
    // Like the backend: the PIN token is only spent once the address saves.
    if (!peekReauthToken()) {
      return failHttp(403, { code: 'REAUTH_REQUIRED', message: 'PIN verification is required' });
    }
    if (!address) return failHttp(404, { error: 'ADDRESS_NOT_FOUND', message: 'No address to update. Add one first.' });
    const waitS = Math.ceil((addressUpdatedAt + ADDRESS_COOLDOWN_S * 1000 - Date.now()) / 1000);
    if (addressUpdatedAt && waitS > 0) {
      const days = Math.ceil(waitS / 86_400);
      return failHttp(
        429,
        {
          error: 'ADDRESS_UPDATE_COOLDOWN',
          message: `You can change your address once every 15 days. Try again in ${days} day${days === 1 ? '' : 's'}.`,
          retry_after: waitS,
        },
        { 'retry-after': String(waitS) },
      );
    }
    const checked = checkMockAddress(payload);
    if (checked instanceof Promise) return checked;
    clearReauthToken();
    address = checked;
    addressUpdatedAt = Date.now();
    return respond(address);
  },
  biometricConsent: (payload: BiometricConsentRequest): Promise<OkResponse> => {
    biometricConsentAccepted = payload.accepted;
    user = {
      ...user,
      biometricConsentAt: payload.accepted ? new Date().toISOString() : null,
    };
    return respond({ ok: true, message: payload.accepted ? 'Consent recorded' : 'Consent withdrawn' });
  },

  // ── Family ───────────────────────────────────────────────────────────
  addFamilyMember: (payload: AddFamilyMemberRequest): Promise<FamilyMember> => {
    const age = ageFromDob(payload.dateOfBirth);
    const ageBand = age >= 10 ? '10+' : age >= 5 ? '5-9' : '0-4';
    const member: FamilyMember = {
      id: nextId('f'),
      name: payload.name,
      relationship: payload.relationship,
      age,
      ageBand: ageBand as FamilyMember['ageBand'],
      verification: ageBand === '0-4' ? 'Doc Verified' : 'Face + Doc Verified',
      turning18Soon: age === 17,
      faceEnrolled: false,
      faceCaptureMode: age < 5 ? 'photo' : 'liveness',
      allowedCameras: age < 10 ? ['front', 'back'] : ['front'],
      dateOfBirth: payload.dateOfBirth,
      permissions: { independentCheckIn: false, notifyOnCheckIn: true },
      createdAt: new Date().toISOString(),
      faceEnrolledAt: null,
      checkInPinSet: false,
    };
    family = [...family, member];
    pushNotification(`${member.name.split(' ')[0]} added to your family`, 'Set up their face to check in together.', 'family', {
      type: 'family',
      personId: member.id,
    });
    return respond(member);
  },
  removeFamilyMember: (id: string): Promise<OkResponse> => {
    family = family.filter((f) => f.id !== id);
    return respond({ ok: true, message: 'Member removed' });
  },
  updateFamilyPermissions: (personId: string, patch: Partial<NonNullable<FamilyMember['permissions']>>): Promise<FamilyMember> => {
    const member = family.find((f) => f.id === personId);
    if (!member) return fail('Family member not found');
    const updated: FamilyMember = {
      ...member,
      permissions: { independentCheckIn: false, notifyOnCheckIn: true, ...member.permissions, ...patch },
    };
    family = family.map((f) => (f.id === personId ? updated : f));
    return respond(updated);
  },
  setFamilyMemberPin: (personId: string, pin: string, _replace = false): Promise<FamilyMember> => {
    const member = family.find((f) => f.id === personId);
    if (!member) return fail('Family member not found');
    if (!/^\d{4}$/.test(pin)) return fail('PIN must be 4 digits');
    const updated: FamilyMember = { ...member, checkInPinSet: true };
    family = family.map((f) => (f.id === personId ? updated : f));
    return respond(updated);
  },

  // ── Bookings / reservations ──────────────────────────────────────────
  /** Every query word must start a word of the business name (as upstream). */
  searchMerchants: (q: string, limit = 10): Promise<MerchantSummary[]> => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return respond([]);
    const hits = merchants.filter((m) => {
      const name = m.businessName.toLowerCase().split(/[^a-z0-9]+/);
      return words.every((w) => name.some((n) => n.startsWith(w)));
    });
    return respond(hits.slice(0, Math.min(limit, 10)));
  },
  createReservation: (payload: CreateReservationRequest): Promise<Booking> => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const merchant = payload.merchantId ? merchants.find((m) => m.merchantId === payload.merchantId) : undefined;
    if (payload.merchantId && !merchant) return fail("This venue isn't available. Search for it and choose it again.");
    // As the BFF: a picked venue's name is the merchant's registered one.
    const venue = (merchant?.businessName ?? payload.venue ?? '').trim();
    if (!venue) return fail('Venue is required');
    if (payload.checkIn < todayStr) return fail('Check-in date cannot be in the past');
    if (payload.checkOut && payload.checkOut < payload.checkIn) return fail('Check-out must be on or after check-in');
    const booking: Booking = {
      id: nextId('res-'),
      source: 'customer',
      venue,
      location: payload.location ?? '',
      type: 'reservation',
      kind: payload.kind ?? 'other',
      image: null,
      checkIn: payload.checkIn,
      checkOut: payload.checkOut ?? null,
      checkedInAt: null,
      status: 'upcoming',
      guests: payload.guests ?? 1,
      amount: null,
      durationMs: null,
      notes: payload.notes ?? null,
      checkedInMembers: [],
      linkedBookingId: null,
      createdAt: new Date().toISOString(),
      merchantId: merchant?.merchantId ?? null,
    };
    bookings = [booking, ...bookings];
    pushNotification('Reservation added', `${booking.venue}, ${booking.checkIn}`, 'booking', { type: 'booking', bookingId: booking.id });
    return respond(booking);
  },
  updateReservation: (id: string, patch: UpdateReservationRequest): Promise<Booking> => {
    const b = bookings.find((x) => x.id === id);
    if (!b) return fail('Booking not found');
    if (b.source !== 'customer' || b.status !== 'upcoming') return fail("This booking can't be changed any more.");
    const merchant = patch.merchantId ? merchants.find((m) => m.merchantId === patch.merchantId) : undefined;
    if (patch.merchantId && !merchant) return fail("This venue isn't available. Search for it and choose it again.");
    const updated: Booking = { ...b, ...patch, checkOut: patch.checkOut ?? b.checkOut, notes: patch.notes ?? b.notes };
    // As upstream: a picked venue takes the merchant's name; a new free-text venue drops the merchant.
    if (merchant) updated.venue = merchant.businessName;
    else if (patch.venue != null && patch.venue !== b.venue) updated.merchantId = null;
    bookings = bookings.map((x) => (x.id === id ? updated : x));
    return respond(updated);
  },
  deleteReservation: (id: string): Promise<OkResponse> => {
    const b = bookings.find((x) => x.id === id);
    if (!b) return fail('Booking not found');
    if (b.source !== 'customer' || b.status !== 'upcoming') return fail("This booking can't be changed any more.");
    bookings = bookings.filter((x) => x.id !== id);
    return respond({ ok: true });
  },

  // ── Documents ────────────────────────────────────────────────────────
  addDocument: (payload: AddDocumentRequest): Promise<IdentityDocument> => {
    const doc: IdentityDocument = {
      id: nextId('d'),
      type: payload.type,
      label: payload.label,
      number: payload.number ?? '',
      status: 'pending',
      matchScore: null,
      addedAt: new Date().toISOString().slice(0, 10),
      expiresAt: payload.expiresAt ?? null,
      source: 'uploaded',
      personId: payload.personId,
    };
    documents = [...documents, doc];
    return respond(doc);
  },
  removeDocument: (id: string): Promise<OkResponse> => {
    documents = documents.filter((d) => d.id !== id);
    return respond({ ok: true, message: 'Document removed' });
  },
  getSupportedDocumentTypes: () => respond(SUPPORTED_TYPES),
  getDocumentUploadUrls: (documentId: string, parts: DocumentImagePart[], _contentType = 'image/jpeg'): Promise<DocumentUploadUrls> => {
    const uploads: DocumentUploadUrls['uploads'] = {};
    for (const part of parts) {
      uploads[part] = { uploadUrl: `mock://upload/${documentId}/${part}`, objectKey: `documents/${documentId}/${part}.jpg` };
    }
    return respond({ uploads, expiresIn: 900 });
  },
  uploadFileToUrl: (_uploadUrl: string, _fileUri: string, _contentType = 'image/jpeg'): Promise<void> => respond(undefined),
  getDocumentImages: (_documentId: string): Promise<DocumentImages> =>
    respond({ front: null, back: null, selfie: null, portrait: null }),

  // ── Document verification sessions ───────────────────────────────────
  createVerificationSession: (documentId: string, payload: VerificationSessionRequest): Promise<VerificationSession> => {
    const id = nextId('vs');
    verificationLiveness.set(id, `${documentId}|${payload.livenessSessionId ?? ''}`);
    return respond({
      id,
      status: 'created',
      documentId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
  },
  startVerificationWithImages: (sessionId: string, payload: VerifyDocumentRequest): Promise<VerifyDocumentResponse> => {
    // Verify is synchronous. Oct 2026 policy: approved | rejected only, and a
    // photo document for a member without a face needs a liveness session.
    const [documentId = 'mock-doc', livenessSessionId = ''] = (verificationLiveness.get(sessionId) ?? '').split('|');
    const doc = documents.find((d) => d.id === documentId);
    const member = doc?.personId ? family.find((f) => f.id === doc.personId) : undefined;
    const now = new Date().toISOString();
    const needsFace = !!member && !member.faceEnrolled && doc?.type !== 'birthCertificate';
    if (needsFace && !(livenessSessionId && payload.sessionToken)) {
      documents = documents.map((d) => (d.id === documentId ? { ...d, status: 'failed' } : d));
      return respond({
        id: sessionId,
        status: 'completed',
        outcome: 'rejected',
        reasonCode: 'FACE_NOT_ENROLLED',
        reasonMessage: REASON_MESSAGES.FACE_NOT_ENROLLED,
        documentId,
        createdAt: now,
        completedAt: now,
        matchScore: null,
      });
    }
    const verified: IdentityDocument | undefined = doc
      ? { ...doc, status: 'verified', matchScore: doc.type === 'birthCertificate' ? null : 0.95, number: doc.number || '•••• 4821', verifiedAt: now }
      : undefined;
    if (verified) {
      // One verified document per type per person.
      documents = documents
        .filter((d) => !(d.id !== verified.id && d.type === verified.type && d.personId === verified.personId && d.status === 'verified'))
        .map((d) => (d.id === verified.id ? verified : d));
    }
    return respond({
      id: sessionId,
      status: 'completed',
      outcome: 'approved',
      reasonCode: null,
      reasonMessage: null,
      documentId,
      createdAt: now,
      completedAt: now,
      matchScore: verified?.matchScore ?? null,
      document: verified,
    });
  },
  startVerification: (sessionId: string): Promise<OkResponse> => {
    return respond({ ok: true, message: `Verification started for ${sessionId}` });
  },
  pollVerification: (sessionId: string): Promise<VerificationSession> => {
    // Per guide §6.7: recovery poll only — not a wait loop
    return respond({
      id: sessionId,
      status: 'completed',
      outcome: 'approved',
      documentId: 'mock-doc',
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
  },

  // ── Liveness (mock — simulates server-provided challenge sequence) ───
  createLivenessChallenge: (_personId?: string): Promise<LivenessChallengeResponse> => {
    const sequence: LivenessChallenge[] = ['turn_left', 'blink', 'turn_right'];
    return respond({
      success: true,
      session_id: nextId('lx'),
      session_token: 'mock-session-token',
      challenge_sequence: sequence,
      expires_in_seconds: 300,
      step_time_limits: { min_ms: 300, max_ms: 10000 },
      ui_copy: {
        blink: 'Blink your eyes',
        turn_left: 'Turn your head slowly to the left',
        turn_right: 'Turn your head slowly to the right',
      },
    });
  },
  submitLivenessEvidence: (
    _sessionId: string,
    payload: LivenessEvidenceRequest,
    _sessionToken: string,
  ): Promise<LivenessEvidenceResponse> => {
    return respond({
      success: true,
      step_accepted: true,
      next_challenge: payload.challenge === 'turn_left' ? 'blink' : payload.challenge === 'blink' ? 'turn_right' : undefined,
      next_instruction: payload.challenge === 'turn_left' ? 'Blink your eyes' : payload.challenge === 'blink' ? 'Turn your head slowly to the right' : undefined,
      status: 'in_progress',
    });
  },
  finalizeLiveness: (sessionId: string, _frameBase64: string, _sessionToken: string): Promise<LivenessFinalizeResponse> => {
    return respond({
      success: true,
      status: 'passed',
      session_id: sessionId,
      antispoof_score: 0.92,
      message: 'Liveness verified.',
    });
  },

  // ── Face enrollment / update ─────────────────────────────────────────
  enrollFace: (payload: FaceEnrollRequest): Promise<FaceResponse> => {
    const now = new Date().toISOString();
    if (payload.personId) {
      family = family.map((f) => (f.id === payload.personId ? { ...f, faceEnrolled: true, faceEnrolledAt: now } : f));
    } else {
      user = { ...user, faceEnrolled: true, faceEnrolledAt: now };
    }
    return respond({ ok: true, faceEnrolled: true, faceId: nextId('face') });
  },
  updateFace: (payload: FaceUpdateRequest): Promise<FaceResponse> => {
    // Mirrors the backend: PUT /face needs a fresh verify-pin token.
    if (!takeReauthToken()) return fail('For your security, enter your PIN again to continue.');
    if (payload.personId) {
      family = family.map((f) => (f.id === payload.personId ? { ...f, faceEnrolled: true, faceEnrolledAt: new Date().toISOString() } : f));
    }
    pushNotification('Face updated', 'Your face was updated for check-in.', 'identity', { type: 'identity', personId: payload.personId });
    return respond({ ok: true, faceEnrolled: true, faceId: nextId('face') });
  },

  // ── Profile picture (mock — no-op) ─────────────────────────────────────
  uploadProfilePicture: (_imageUri: string, _personId?: string): Promise<ProfilePictureResponse> => {
    return respond({ url: '', expires_in: 3600, updated_at: new Date().toISOString() });
  },
  getProfilePicture: (_personId?: string): Promise<ProfilePictureResponse | null> => {
    return respond(null);
  },
};
