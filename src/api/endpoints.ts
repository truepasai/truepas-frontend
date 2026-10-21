import { apiClient, getPreauthToken, getRegistrationToken, setRegistrationToken } from '@/api/client';
import { deviceInfo } from '@/services/deviceInfo';
import { setReauthToken, takeReauthToken } from '@/services/reauth';
import type {
    AccountDetailsRequest,
    AccountDetailsResponse,
    ActivityItem,
    ActivityLogItem,
    AppPreferences,
    AuthSession,
    CreateReservationRequest,
    DataExport,
    DocumentImagePart,
    DocumentImages,
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

/** "Oct 5, 10:04 AM" — activity times are ISO since Oct 2026 (§10.1). */
function fmtActivityTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Account activity: Oct 2026 { type, occurredAt, tone, ref } or the older
 *  { timestamp } shape -> ActivityItem with a display `timestamp`. */
export function normalizeActivity(raw: unknown): ActivityItem {
  const a = (raw ?? {}) as Record<string, unknown>;
  const occurredAt = typeof a.occurredAt === 'string' ? a.occurredAt : undefined;
  return {
    id: String(a.id ?? ''),
    title: String(a.title ?? ''),
    timestamp: typeof a.timestamp === 'string' ? a.timestamp : fmtActivityTime(occurredAt),
    tone: (a.tone as ActivityItem['tone']) ?? 'neutral',
    type: a.type as ActivityItem['type'],
    occurredAt,
    ref: (a.ref as ActivityItem['ref']) ?? undefined,
  };
}

function normalizeMemberActivity(raw: unknown): ActivityLogItem {
  const a = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(a.id ?? ''),
    title: String(a.title ?? ''),
    date: String(a.occurredAt ?? a.date ?? ''),
    type: a.type as ActivityLogItem['type'],
    tone: a.tone as ActivityLogItem['tone'],
    ref: (a.ref as ActivityLogItem['ref']) ?? undefined,
  };
}

/** Inbox items are snake_case ({ message, is_read, created_at, notification_type, data, read_at }). */
export function normalizeNotification(raw: unknown): Notification {
  const n = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(n.id ?? ''),
    title: String(n.title ?? ''),
    body: String(n.message ?? n.body ?? ''),
    read: Boolean(n.is_read ?? n.read ?? false),
    createdAt: String(n.created_at ?? n.createdAt ?? ''),
    type: (n.notification_type ?? n.type) as string | undefined,
    data: (n.data as Notification['data']) ?? null,
    readAt: (n.read_at ?? n.readAt ?? null) as string | null,
  };
}

function authFrom(data: Record<string, unknown>): AuthResponse {
  return {
    user: data.user as User,
    accessToken: (data.accessToken ?? data.access_token) as string,
    refreshToken: (data.refreshToken ?? data.refresh_token) as string,
  };
}

/** PUT a local file (file:// or content:// URI, data: URI on web) to a presigned URL. */
async function putFile(uploadUrl: string, fileUri: string, contentType: string): Promise<void> {
  // Send bytes, not a Blob: Expo's fetch replaces Content-Type with a Blob's
  // own type (empty for a local file), and the URL is signed for exactly
  // this Content-Type — anything else is a 403 SignatureDoesNotMatch.
  const bytes = new Uint8Array(await (await fetch(fileUri)).arrayBuffer());
  const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes });
  if (!res.ok) {
    const code = (await res.text().catch(() => '')).match(/<Code>([^<]+)<\/Code>/)?.[1];
    throw new Error(`Upload failed (${res.status}${code ? ` ${code}` : ''})`);
  }
}

/** Liveness routes take the face sign-in preauth token instead of the
 *  access token while a face sign-in is in progress (§4.5). */
function livenessAuth(): Record<string, string> {
  const t = getPreauthToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/**
 * Real REST API layer — same function signatures as `mockApi` so screens/hooks
 * never need to change when we switch from mock JSON fixtures to the live
 * backend.
 *
 * All calls go through the BFF (customer-app-bff) at /cb/*.
 * The app must never call internal services directly.
 */
export const realApi = {
  // ── Reads ────────────────────────────────────────────────────────────
  getUser: async (): Promise<User> => {
    const { data } = await apiClient.get<User>('/user/me');
    return data;
  },
  getIdentitySummary: async (): Promise<IdentitySummary> => {
    const { data } = await apiClient.get<IdentitySummary>('/identity/summary');
    return { ...data, activity: (Array.isArray(data?.activity) ? data.activity : []).map(normalizeActivity) };
  },
  getDocuments: async (personId?: string): Promise<IdentityDocument[]> => {
    const { data } = await apiClient.get<IdentityDocument[]>(
      '/documents',
      personId ? { params: { personId } } : undefined,
    );
    // Ids, types and statuses only — the items carry holder names and DOBs.
    console.log(
      '[API] GET /documents',
      personId ? `person=${personId}` : '(self)',
      Array.isArray(data)
        ? `→ ${data.length}: ${data.map((d) => `${d.id.slice(0, 8)} ${d.type} ${d.status}${d.matchScore != null ? ` match=${d.matchScore.toFixed(2)}` : ''}`).join(', ')}`
        : '→ unexpected shape',
    );
    return data;
  },
  getDocument: async (id: string): Promise<IdentityDocument | null> => {
    const { data } = await apiClient.get<IdentityDocument>(`/documents/${id}`);
    return data;
  },
  getFamily: async (): Promise<FamilyMember[]> => {
    const { data } = await apiClient.get<FamilyMember[]>('/family');
    return data;
  },
  getFamilyMember: async (id: string): Promise<FamilyMember | null> => {
    const { data } = await apiClient.get<FamilyMember>(`/family/${id}`);
    return data;
  },
  getFamilyActivity: async (id: string): Promise<ActivityLogItem[]> => {
    const { data } = await apiClient.get<unknown[]>(`/family/${id}/activity`);
    return (Array.isArray(data) ? data : []).map(normalizeMemberActivity);
  },
  getBookings: async (): Promise<Booking[]> => {
    const { data } = await apiClient.get<unknown>('/bookings');
    // [] is the valid "no check-ins yet" state, and an empty body means the
    // same. Unwrap the common list envelopes; any other shape is a contract
    // mismatch and must surface as an error — silently returning [] made real
    // check-ins look like an empty history (BUG018).
    if (data == null || data === '') return [];
    if (Array.isArray(data)) return data as Booking[];
    if (typeof data === 'object') {
      const envelope = data as Record<string, unknown>;
      for (const key of ['bookings', 'items', 'data', 'content'] as const) {
        if (Array.isArray(envelope[key])) return envelope[key] as Booking[];
      }
    }
    if (__DEV__) console.warn('[API] GET /bookings → unexpected response shape', JSON.stringify(data));
    throw new Error('Unexpected /bookings response shape');
  },
  getBooking: async (id: string): Promise<Booking | null> => {
    const { data } = await apiClient.get<Booking>(`/bookings/${id}`);
    return data;
  },
  getNotifications: async (params?: {
    limit?: number;
    offset?: number;
    unreadOnly?: boolean;
    type?: NotificationType;
  }): Promise<Notification[]> => {
    const { data } = await apiClient.get<unknown[]>('/notifications', {
      params: {
        limit: params?.limit ?? 50,
        offset: params?.offset ?? 0,
        unread_only: params?.unreadOnly ?? false,
        ...(params?.type ? { type: params.type } : {}),
      },
    });
    // Contract schema is snake_case — normalize to the app's Notification shape.
    return (Array.isArray(data) ? data : []).map(normalizeNotification);
  },
  getNotificationCount: async (type?: NotificationType): Promise<NotificationCount> => {
    const { data } = await apiClient.get<Record<string, unknown>>('/notifications/count', {
      params: type ? { type } : undefined,
    });
    return { total: Number(data?.total_count ?? 0), unread: Number(data?.unread_count ?? 0) };
  },
  markNotificationRead: async (id: string): Promise<OkResponse> => {
    const { data } = await apiClient.post<OkResponse>(`/notifications/${id}/read`);
    return data;
  },
  markNotificationsRead: async (ids: string[]): Promise<OkResponse> => {
    const { data } = await apiClient.post<OkResponse>('/notifications/read', { notification_ids: ids });
    return data;
  },
  markAllNotificationsRead: async (): Promise<OkResponse> => {
    const { data } = await apiClient.post<OkResponse>('/notifications/read-all');
    return data;
  },
  getNotificationPreferences: async (): Promise<NotificationPreferences> => {
    const { data } = await apiClient.get<NotificationPreferences>('/user/me/notification-preferences');
    return data;
  },
  /** Send only what changed. */
  updateNotificationPreferences: async (patch: Partial<NotificationPreferences>): Promise<NotificationPreferences> => {
    const { data } = await apiClient.put<NotificationPreferences>('/user/me/notification-preferences', patch);
    return data;
  },
  registerPushDevice: async (pushToken: string, platform: 'ios' | 'android'): Promise<PushDevice> => {
    const { data } = await apiClient.post<PushDevice>('/user/me/devices', { pushToken, platform });
    return data;
  },
  getPushDevices: async (): Promise<PushDevice[]> => {
    const { data } = await apiClient.get<PushDevice[]>('/user/me/devices');
    return Array.isArray(data) ? data : [];
  },
  deletePushDevice: async (id: string): Promise<OkResponse> => {
    const { data } = await apiClient.delete<OkResponse>(`/user/me/devices/${id}`);
    return data;
  },

  // ── Home / profile / settings data (Oct 2026) ───────────────────────
  getAccountActivity: async (): Promise<ActivityItem[]> => {
    const { data } = await apiClient.get<unknown[]>('/user/me/activity');
    return (Array.isArray(data) ? data : []).map(normalizeActivity);
  },
  getSecurityScore: async (): Promise<SecurityScore> => {
    const { data } = await apiClient.get<SecurityScore>('/user/me/security-score');
    return { ...data, suggestions: Array.isArray(data?.suggestions) ? data.suggestions : [] };
  },
  getUserStats: async (year: number): Promise<UserStats> => {
    const { data } = await apiClient.get<UserStats>('/user/me/stats', { params: { year } });
    return data;
  },
  getPreferences: async (): Promise<AppPreferences> => {
    const { data } = await apiClient.get<AppPreferences>('/user/me/preferences');
    return data;
  },
  /** Send only what changed. */
  updatePreferences: async (patch: Partial<AppPreferences>): Promise<AppPreferences> => {
    const { data } = await apiClient.put<AppPreferences>('/user/me/preferences', patch);
    return data;
  },
  getSupportChannels: async (): Promise<SupportChannels> => {
    const { data } = await apiClient.get<SupportChannels>('/support/channels');
    return data;
  },
  requestDataExport: async (): Promise<DataExport> => {
    const { data } = await apiClient.post<DataExport>('/user/me/export');
    return data;
  },
  getDataExport: async (exportId: string): Promise<DataExport> => {
    const { data } = await apiClient.get<DataExport>(`/user/me/export/${exportId}`);
    return data;
  },

  // ── Auth ─────────────────────────────────────────────────────────────
  /** 200 -> tokens; 202 -> { nextStep: 'verify2fa', challengeId, method } (§4.2). */
  login: async (payload: LoginRequest): Promise<LoginResult> => {
    const res = await apiClient.post<Record<string, unknown>>('/auth/login', { ...payload, device: payload.device ?? deviceInfo() });
    const data = res.data ?? {};
    if (res.status === 202 || data.nextStep === 'verify2fa') {
      return {
        nextStep: 'verify2fa',
        challengeId: String(data.challengeId ?? data.challenge_id ?? ''),
        method: (data.method as TwoFactorMethod) ?? 'email',
      };
    }
    // Handle both camelCase and snake_case token fields from backend
    return authFrom(data);
  },
  verifyTwoFactor: async (payload: { challengeId: string; code: string }): Promise<AuthResponse> => {
    const { data } = await apiClient.post<Record<string, unknown>>('/auth/2fa/verify', { ...payload, device: deviceInfo() });
    return authFrom(data);
  },
  enableTwoFactor: async (method: TwoFactorMethod): Promise<TwoFactorEnableResponse> => {
    const { data } = await apiClient.post<TwoFactorEnableResponse>('/auth/2fa/enable', { method });
    return data;
  },
  confirmTwoFactor: async (payload: { challengeId: string; code: string }): Promise<TwoFactorStatusResponse> => {
    const { data } = await apiClient.post<TwoFactorStatusResponse>('/auth/2fa/confirm', payload);
    return data;
  },
  disableTwoFactor: async (pin: string): Promise<TwoFactorStatusResponse> => {
    const { data } = await apiClient.post<TwoFactorStatusResponse>('/auth/2fa/disable', { pin });
    return data;
  },
  getSessions: async (): Promise<AuthSession[]> => {
    // The BFF passes account-service's { sessions: [...] } through; a bare
    // array is the older contract (§4.3).
    const { data } = await apiClient.get<AuthSession[] | { sessions?: AuthSession[] }>('/auth/sessions');
    if (Array.isArray(data)) return data;
    return Array.isArray(data?.sessions) ? data.sessions : [];
  },
  revokeSession: async (id: string): Promise<RevokeSessionsResponse> => {
    const { data } = await apiClient.delete<RevokeSessionsResponse>(`/auth/sessions/${id}`);
    return data;
  },
  revokeOtherSessions: async (): Promise<RevokeSessionsResponse> => {
    const { data } = await apiClient.post<RevokeSessionsResponse>('/auth/sessions/revoke-others');
    return data;
  },
  /** Always 202 with a preauth token, even for unknown accounts (§4.5). */
  startFaceLogin: async (payload: { identifier: string; purpose: FaceLoginPurpose }): Promise<FaceLoginStartResponse> => {
    const { data } = await apiClient.post<FaceLoginStartResponse>('/auth/face-login/start', payload);
    return data;
  },
  faceLogin: async (payload: { preauthToken: string; livenessSessionId: string; sessionToken: string }): Promise<FaceLoginResult> => {
    const { data } = await apiClient.post<Record<string, unknown>>('/auth/face-login', { ...payload, device: deviceInfo() });
    if (typeof data?.resetToken === 'string') {
      return { resetToken: data.resetToken, expiresIn: Number(data.expiresIn ?? 300) };
    }
    return authFrom(data);
  },
  resetPin: async (payload: ResetPinRequest): Promise<OkResponse> => {
    const { data } = await apiClient.post<OkResponse>('/auth/reset-pin', payload);
    return data;
  },
  register: async (payload: RegisterRequest): Promise<RegisterResponse> => {
    console.log('[API] POST /auth/register', JSON.stringify(payload));
    const { data } = await apiClient.post<RegisterResponse>('/auth/register', payload);
    console.log('[API] /auth/register response:', JSON.stringify(data));
    return data;
  },
  verifyOtp: async (payload: VerifyOtpRequest): Promise<VerifyOtpResponse> => {
    // Send both camelCase and snake_case registration_id — backend may expect either.
    const requestPayload: Record<string, unknown> = { ...payload };
    if (payload.registrationId) {
      requestPayload.registration_id = payload.registrationId;
    }
    // For email verification during registration, send the registration token as Bearer
    // so the backend can link this to the ongoing registration session.
    // password_reset has no registration session — a stale in-memory token would
    // make the backend treat this as a registration verify and return 400.
    const registrationToken = payload.purpose === 'password_reset' ? null : getRegistrationToken();
    // Registration OTPs open a session — label it (§3.2).
    if (payload.purpose !== 'password_reset') requestPayload.device = deviceInfo();
    const config = registrationToken
      ? { headers: { Authorization: `Bearer ${registrationToken}` } }
      : undefined;
    console.log('[API] POST /auth/verify-otp', JSON.stringify({ ...requestPayload, otp: '***' }), registrationToken ? 'with registration token' : 'no registration token');
    const { data } = await apiClient.post<VerifyOtpResponse>('/auth/verify-otp', requestPayload, config);
    console.log('[API] /auth/verify-otp response:', JSON.stringify({ ...data, registrationToken: data.registrationToken ? '***' : undefined }));
    // Handle both camelCase and snake_case from backend
    return {
      ...data,
      registrationToken: data.registrationToken ?? (data as any).registration_token,
      accessToken: data.accessToken ?? (data as any).access_token,
      refreshToken: data.refreshToken ?? (data as any).refresh_token,
    };
  },
  completeAccountDetails: async (payload: AccountDetailsRequest): Promise<AccountDetailsResponse> => {
    const registrationToken = getRegistrationToken();
    console.log('[API] POST /auth/account-details', JSON.stringify({ ...payload, password: '***', confirmPassword: '***', pin: '***' }), registrationToken ? 'with registration token' : 'NO REGISTRATION TOKEN');
    const { data } = await apiClient.post<AccountDetailsResponse>(
      '/auth/account-details',
      payload,
      registrationToken ? { headers: { Authorization: `Bearer ${registrationToken}` } } : undefined,
    );
    console.log('[API] /auth/account-details response:', JSON.stringify({ ...data, registrationToken: data.registrationToken ? '***' : undefined }));
    // If backend returns a new registration token for the email step, update it.
    const newToken = data.registrationToken ?? (data as any).registration_token;
    if (newToken) {
      console.log('[API] Account-details returned new registration token for email step');
      setRegistrationToken(newToken);
    }
    return data;
  },
  forgotPassword: async (payload: ForgotPasswordRequest): Promise<OkResponse> => {
    const { data } = await apiClient.post<OkResponse>('/auth/forgot-password', payload);
    return data;
  },
  resetPassword: async (payload: ResetPasswordRequest): Promise<OkResponse> => {
    const { data } = await apiClient.post<OkResponse>('/auth/reset-password', payload);
    return data;
  },
  changePassword: async (payload: ChangePasswordRequest): Promise<OkResponse> => {
    const { data } = await apiClient.post<OkResponse>('/auth/change-password', payload);
    return data;
  },
  changePin: async (payload: ChangePinRequest): Promise<OkResponse> => {
    const { data } = await apiClient.post<OkResponse>('/auth/change-pin', payload);
    return data;
  },
  /** Also returns a single-use reauthToken (5 min) that PUT /face needs;
   *  it is kept in services/reauth and consumed by updateFace. */
  verifyPin: async (pin: string, scope?: PinScope): Promise<VerifyPinResponse> => {
    // The token only works for its scope: face_update (the default) for
    // PUT /face, check_in_pin_update for changing a twin's check-in PIN.
    const { data } = await apiClient.post<VerifyPinResponse>('/auth/verify-pin', scope ? { pin, scope } : { pin });
    if (data?.reauthToken) setReauthToken(data.reauthToken, data.expiresIn ?? 300);
    return data;
  },
  logout: async (payload: LogoutRequest): Promise<OkResponse> => {
    const { data } = await apiClient.post<OkResponse>('/auth/logout', payload);
    return data;
  },
  deleteAccount: async (payload: DeleteAccountRequest): Promise<OkResponse> => {
    const { data } = await apiClient.delete<OkResponse>('/user/me', { data: payload });
    return data;
  },

  // ── Profile ──────────────────────────────────────────────────────────
  updateProfile: async (payload: UpdateProfileRequest): Promise<User> => {
    const { data } = await apiClient.put<User>('/user/me', payload);
    return data;
  },
  biometricConsent: async (payload: BiometricConsentRequest): Promise<OkResponse> => {
    const { data } = await apiClient.post<OkResponse>('/user/me/biometric-consent', payload);
    return data;
  },

  // ── Family ───────────────────────────────────────────────────────────
  addFamilyMember: async (payload: AddFamilyMemberRequest): Promise<FamilyMember> => {
    const { data } = await apiClient.post<FamilyMember>('/family', payload);
    return data;
  },
  removeFamilyMember: async (id: string): Promise<OkResponse> => {
    const { data } = await apiClient.delete<OkResponse>(`/family/${id}`);
    return data;
  },
  /** Returns the full member. independentCheckIn is stored, not enforced yet. */
  updateFamilyPermissions: async (
    personId: string,
    patch: Partial<NonNullable<FamilyMember['permissions']>>,
  ): Promise<FamilyMember> => {
    const { data } = await apiClient.patch<FamilyMember>(`/family/${personId}/permissions`, patch);
    return data;
  },
  /** A twin's 4-digit check-in PIN — the kiosk asks for it to tell twins
   *  apart. Proposed (BACKEND_TWIN_PIN_REQUEST.md). Replacing a set PIN
   *  sends the account holder's reauthToken from verifyPin. Returns the
   *  full member. */
  setFamilyMemberPin: async (personId: string, pin: string, replace = false): Promise<FamilyMember> => {
    const reauth = replace ? takeReauthToken() : null;
    const { data } = await apiClient.put<FamilyMember>(
      `/family/${personId}/check-in-pin`,
      { pin },
      { headers: reauth ? { 'X-Reauth-Token': reauth } : undefined },
    );
    return data;
  },

  // ── Bookings / reservations ──────────────────────────────────────────
  /** TruePas venues for the reservation form: active merchants matching
   *  every query word, at most 10. A blank query returns []. */
  searchMerchants: async (q: string, limit = 10): Promise<MerchantSummary[]> => {
    const { data } = await apiClient.get<MerchantSummary[]>('/merchants', { params: { q, limit } });
    return Array.isArray(data) ? data : [];
  },
  createReservation: async (payload: CreateReservationRequest): Promise<Booking> => {
    const { data } = await apiClient.post<Booking>('/bookings', payload);
    return data;
  },
  updateReservation: async (id: string, patch: UpdateReservationRequest): Promise<Booking> => {
    const { data } = await apiClient.patch<Booking>(`/bookings/${id}`, patch);
    return data;
  },
  deleteReservation: async (id: string): Promise<OkResponse> => {
    const { data } = await apiClient.delete<OkResponse>(`/bookings/${id}`);
    return data;
  },

  // ── Documents ────────────────────────────────────────────────────────
  addDocument: async (payload: AddDocumentRequest): Promise<IdentityDocument> => {
    const { data } = await apiClient.post<IdentityDocument>('/documents', payload);
    return data;
  },
  removeDocument: async (id: string): Promise<OkResponse> => {
    const { data } = await apiClient.delete<OkResponse>(`/documents/${id}`);
    return data;
  },
  /** Build the "Add document" picker from this, filtered by age (§6.1). */
  getSupportedDocumentTypes: async (): Promise<SupportedDocumentType[]> => {
    const { data } = await apiClient.get<SupportedDocumentType[]>('/documents/types/supported');
    return Array.isArray(data) ? data : [];
  },
  /** Presigned PUT URLs (15 min) — avoids 413 on large photos (§6.2). */
  getDocumentUploadUrls: async (
    documentId: string,
    parts: DocumentImagePart[],
    contentType = 'image/jpeg',
  ): Promise<DocumentUploadUrls> => {
    const { data } = await apiClient.post<DocumentUploadUrls>(`/documents/${documentId}/upload-urls`, { parts, contentType });
    return data;
  },
  /** PUT a local image file to a presigned URL from getDocumentUploadUrls. */
  uploadFileToUrl: async (uploadUrl: string, fileUri: string, contentType = 'image/jpeg'): Promise<void> => {
    await putFile(uploadUrl, fileUri, contentType);
  },
  /** Signed, expiring URLs — refetch rather than cache; null parts = placeholder. */
  getDocumentImages: async (documentId: string): Promise<DocumentImages> => {
    const { data } = await apiClient.get<Partial<DocumentImages>>(`/documents/${documentId}/images`);
    return {
      front: data?.front ?? null,
      back: data?.back ?? null,
      selfie: data?.selfie ?? null,
      portrait: data?.portrait ?? null,
    };
  },

  // ── Document verification sessions ───────────────────────────────────
  createVerificationSession: async (documentId: string, payload: VerificationSessionRequest): Promise<VerificationSession> => {
    const { data } = await apiClient.post<VerificationSession>(
      `/documents/${documentId}/verification-sessions`,
      payload,
    );
    // Backend returns `sessionId`, the app type expects `id` — normalize it.
    const raw = data as any;
    return {
      ...data,
      id: data.id ?? raw.sessionId ?? raw.session_id,
    };
  },
  /** POST /document-verification-sessions/{sessionId}/verify
   *  Per guide §6.3: SYNCHRONOUS result — no polling needed.
   *  Images sent as base64 in the body (NOT as object keys). */
  startVerificationWithImages: async (
    sessionId: string,
    payload: VerifyDocumentRequest,
    config?: { timeout?: number },
  ): Promise<VerifyDocumentResponse> => {
    const { data } = await apiClient.post<VerifyDocumentResponse>(
      `/document-verification-sessions/${sessionId}/verify`,
      payload,
      config,
    );
    return data;
  },
  /** Legacy: start verification without images (not per guide — kept for compatibility) */
  startVerification: async (sessionId: string): Promise<OkResponse> => {
    const { data } = await apiClient.post<OkResponse>(`/document-verification-sessions/${sessionId}/verify`);
    return data;
  },
  /** GET /document-verification-sessions/{sessionId} — recovery poll only
   *  Per guide §6.7: use only to recover from crash/app-kill, not as a wait loop */
  pollVerification: async (sessionId: string): Promise<VerificationSession> => {
    const { data } = await apiClient.get<VerificationSession>(`/document-verification-sessions/${sessionId}`);
    return data;
  },

  // ── Liveness (via BFF /cb/liveness/*) ────────────────────────────────
  createLivenessChallenge: async (personId?: string): Promise<LivenessChallengeResponse> => {
    console.log('[API] POST /liveness/v2/challenge', personId ? `personId=${personId}` : '(no personId)');
    // Per KYC guide §4.3: personId is a QUERY PARAM (?personId=), not a body field.
    // Sending it in the body causes the BFF to bind the session to the authed
    // user, and family face enroll then fails with 409 CONFLICT.
    const { data } = await apiClient.post<LivenessChallengeResponse>(
      '/liveness/v2/challenge',
      null,
      { params: personId ? { personId } : undefined, headers: livenessAuth() },
    );
    // session_token is a bearer credential — never log it.
    console.log('[API] /liveness/v2/challenge response:', JSON.stringify({ ...data, session_token: data.session_token ? '***' : undefined }));
    return data;
  },
  submitLivenessEvidence: async (
    sessionId: string,
    payload: LivenessEvidenceRequest,
    sessionToken: string,
  ): Promise<LivenessEvidenceResponse> => {
    // Per KYC guide §4.2: Evidence carries NO image — only step metadata.
    // BFF drops JSON bodies on this route but forwards form-encoded data
    // correctly (confirmed via curl — JSON returns 422, form-encoded works).
    // Send as application/x-www-form-urlencoded until the BFF is fixed.
    const formBody = new URLSearchParams();
    formBody.append('challenge', payload.challenge);
    formBody.append('step_index', String(payload.step_index));
    formBody.append('client_ts_ms', String(payload.client_ts_ms));
    formBody.append('duration_ms', String(payload.duration_ms));
    console.log('[API] POST /liveness/v2/challenge/:id/evidence', formBody.toString());

    const { data } = await apiClient.post<LivenessEvidenceResponse>(
      `/liveness/v2/challenge/${sessionId}/evidence`,
      formBody.toString(),
      {
        headers: {
          ...livenessAuth(),
          'X-Session-Token': sessionToken,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );
    console.log('[API] /liveness/v2/challenge/:id/evidence response:', JSON.stringify(data));
    return data;
  },
  finalizeLiveness: async (
    sessionId: string,
    frameUri: string,
    sessionToken: string,
  ): Promise<LivenessFinalizeResponse> => {
    const formData = new FormData();
    formData.append('frame', {
      uri: frameUri,
      type: 'image/jpeg',
      name: 'finalize.jpg',
    } as any);

    const { data } = await apiClient.post<LivenessFinalizeResponse>(
      `/liveness/v2/challenge/${sessionId}/finalize`,
      formData,
      {
        headers: {
          ...livenessAuth(),
          'X-Session-Token': sessionToken,
          'Content-Type': 'multipart/form-data',
        },
      },
    );
    return data;
  },

  // ── Face enrollment / update (via BFF /cb/face/*) ────────────────────
  enrollFace: async (payload: FaceEnrollRequest): Promise<FaceResponse> => {
    const { data } = await apiClient.post<FaceResponse>('/face/enroll', payload);
    return data;
  },
  /** Needs the reauthToken from verifyPin (single use) — without it the
   *  backend answers 403 REAUTH_REQUIRED and the PIN must be asked again. */
  updateFace: async (payload: FaceUpdateRequest): Promise<FaceResponse> => {
    const reauth = takeReauthToken();
    const { data } = await apiClient.put<FaceResponse>('/face', payload, {
      headers: reauth ? { 'X-Reauth-Token': reauth } : undefined,
    });
    return data;
  },

  // ── Profile picture (persons API, §12) ───────────────────────────────
  /** POST /persons/{id}/profile-image/upload-url -> PUT the image -> PUT
   *  /persons/{id}/profile-image { objectKey }. Works for family members
   *  too; defaults to the signed-in user's own id. */
  uploadProfilePicture: async (imageUri: string, personId?: string): Promise<ProfilePictureResponse> => {
    const id = personId ?? (await apiClient.get<User>('/user/me')).data.id;
    const { data: target } = await apiClient.post<{ uploadUrl: string; objectKey: string }>(
      `/persons/${id}/profile-image/upload-url`,
      { contentType: 'image/jpeg' },
    );
    await putFile(target.uploadUrl, imageUri, 'image/jpeg');
    await apiClient.put(`/persons/${id}/profile-image`, { objectKey: target.objectKey });
    // The photo is saved on the server now. Failing to read its new link
    // back must not report the upload as failed ("shows on this phone only").
    const pic = await realApi.getProfilePicture(personId).catch(() => null);
    return pic ?? { url: imageUri, expires_in: 0, updated_at: new Date().toISOString() };
  },
  /** The signed photo URL from GET /user/me (or the family member). */
  getProfilePicture: async (personId?: string): Promise<ProfilePictureResponse | null> => {
    const { data } = personId
      ? await apiClient.get<FamilyMember>(`/family/${personId}`)
      : await apiClient.get<User>('/user/me');
    const url = (data as { profileImageUrl?: string | null })?.profileImageUrl;
    return url ? { url, expires_in: 3000, updated_at: null } : null;
  },
};
