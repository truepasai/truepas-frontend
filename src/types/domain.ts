export type VerificationStatus = 'verified' | 'pending' | 'missing' | 'failed';

export interface User {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  dateOfBirth?: string;
  /** Writable via PUT /user/me; absent on payloads that don't return it. */
  address?: string;
  faceEnrolled: boolean;
  biometricConsentAt: string | null;
  /** Oct 2026 additions (GET /user/me) — absent on older payloads. */
  faceEnrolledAt?: string | null;
  passwordChangedAt?: string | null;
  pinChangedAt?: string | null;
  twoFactorEnabled?: boolean;
  twoFactorMethod?: TwoFactorMethod | null;
  /** Signed profile photo URL (GET /user/me). Face sign-in / 2-step verify
   *  return only profileImageKey — refetch /user/me for the URL. */
  profileImageUrl?: string | null;
  profileImageKey?: string | null;
}

export interface IdentitySummary {
  status: 'incomplete' | 'verified';
  face: VerificationStatus;
  document: VerificationStatus;
  selfieMatch: VerificationStatus;
  activity: ActivityItem[];
}

/** Account activity (GET /user/me/activity, identity summary `activity`).
 *  `timestamp` is a display string: the normalizer formats `occurredAt`
 *  locally (older payloads sent a preformatted `timestamp`). */
export interface ActivityItem {
  id: string;
  title: string;
  timestamp: string;
  tone: 'success' | 'warning' | 'error' | 'neutral';
  type?: ActivityType;
  occurredAt?: string;
  ref?: ActivityRef;
}

export type ActivityType =
  | 'face_enrolled'
  | 'document_added'
  | 'document_verified'
  | 'document_failed'
  | 'family_member_added'
  | 'family_face_enrolled'
  | 'check_in'
  | 'password_changed'
  | 'pin_changed';

export interface ActivityRef {
  documentId?: string;
  personId?: string;
  bookingId?: string;
}

export type DocumentType =
  | 'passport'
  | 'drivingLicense'
  | 'idCard'
  | 'greenCard'
  | 'birthCertificate'
  | 'usVisa';

export interface IdentityDocument {
  id: string;
  type: DocumentType;
  label: string;
  number: string;
  status: VerificationStatus;
  matchScore: number | null;
  addedAt: string;
  expiresAt: string | null;
  source?: 'uploaded' | 'verified';
  personId?: string;
  /** Extracted data fields — returned by backend after Regula processing.
   *  These mirror Facepe's VerifiedDocument schema and are populated by the
   *  backend's document verification flow. See BUG_REPORT_BACKEND_EXTRACTED_DATA.md */
  extractedName?: string | null;
  extractedDob?: string | null;
  nationality?: string | null;
  issuingState?: string | null;
  portraitImageUrl?: string | null;
  documentImageUrl?: string | null;
  /** When the document was approved (Oct 2026). */
  verifiedAt?: string | null;
}

export type FamilyAgeBand = '0-4' | '5-9' | '10+';

export interface FamilyMember {
  id: string;
  name: string;
  relationship: string;
  age: number;
  ageBand: FamilyAgeBand;
  verification: string;
  turning18Soon: boolean;
  faceEnrolled: boolean;
  /** 'photo' under 5, 'liveness' 5+ — absent on older payloads. */
  faceCaptureMode?: 'photo' | 'liveness';
  /** Sent at creation; absent on older payloads. */
  dateOfBirth?: string;
  /** Capture cameras allowed; 'back' is added for members under 10. */
  allowedCameras?: ('front' | 'back')[];
  /** Oct 2026 additions on every family read. */
  permissions?: FamilyPermissions;
  createdAt?: string | null;
  faceEnrolledAt?: string | null;
  /** Signed photo URL when the member has a profile image (persons API). */
  profileImageUrl?: string | null;
  /** Twins only: their own check-in PIN is set (PUT /family/{id}/check-in-pin).
   *  Proposed — absent until the backend ships it. */
  checkInPinSet?: boolean;
  /** Backend's own twin flag (relationship tagged Twin, any case/spacing). */
  isTwin?: boolean;
}

export interface FamilyPermissions {
  /** Stored but not enforced yet (consent-policy review) — show as coming soon. */
  independentCheckIn: boolean;
  notifyOnCheckIn: boolean;
}

export type BookingKind = 'hotel' | 'park' | 'flight' | 'cinema' | 'cruise' | 'stadium' | 'concert' | 'other';
export type BookingStatus = 'completed' | 'failed' | 'upcoming' | 'expired';

/** GET /bookings — kiosk check-ins and the customer's own reservations. */
export interface Booking {
  id: string;
  venue: string;
  location: string;
  /** 'reservation' | 'checkin' on Oct 2026 payloads; a venue type on older ones. */
  type: string;
  image: string | null;
  checkIn: string;
  checkOut: string | null;
  status: BookingStatus;
  guests: number;
  amount: number | null;
  checkedInMembers?: string[];
  /** Oct 2026 additions. */
  source?: 'customer' | 'checkin';
  kind?: BookingKind | null;
  /** Exact kiosk check-in time (ISO) — format in the user's time zone. */
  checkedInAt?: string | null;
  durationMs?: number | null;
  notes?: string | null;
  /** The other side of a reservation <-> check-in link. */
  linkedBookingId?: string | null;
  createdAt?: string | null;
  /** The TruePas venue (merchant) a reservation is for; null on free-text
   *  venues, which a kiosk check-in can't match. */
  merchantId?: string | null;
}

/** GET /merchants?q= — a TruePas venue the customer can reserve at. */
export interface MerchantSummary {
  merchantId: string;
  businessName: string;
}

/** POST /bookings — a customer reservation. Dates are local YYYY-MM-DD. */
export interface CreateReservationRequest {
  venue: string;
  /** Picked from GET /merchants; the BFF checks it is an active merchant
   *  and sets `venue` to its registered business name. */
  merchantId?: string;
  location?: string;
  kind?: BookingKind;
  checkIn: string;
  checkOut?: string;
  guests?: number;
  memberIds?: string[];
  notes?: string;
}

export type UpdateReservationRequest = Partial<CreateReservationRequest>;

/** Member activity (GET /family/{id}/activity) — same feed shape as the
 *  account activity; `date` is the ISO time (occurredAt). */
export interface ActivityLogItem {
  id: string;
  title: string;
  date: string;
  type?: ActivityType;
  tone?: ActivityItem['tone'];
  ref?: ActivityRef;
}

// ── Write operation payloads & responses ──────────────────────────────
// These shapes define the API contract shared with the backend team.

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface LoginRequest {
  identifier: string;
  password: string;
  device?: DeviceInfo;
}

/** Labels the session in "Signed-in devices" (login, refresh, OTP, 2FA, face login). */
export interface DeviceInfo {
  name: string;
  platform: 'android' | 'ios' | 'web';
  appVersion: string;
}

export type TwoFactorMethod = 'email' | 'totp';

/** 202 from POST /auth/login when 2-step sign-in is on. */
export interface TwoFactorChallenge {
  nextStep: 'verify2fa';
  challengeId: string;
  method: TwoFactorMethod;
}

export type LoginResult = AuthResponse | TwoFactorChallenge;

export function isTwoFactorChallenge(r: LoginResult): r is TwoFactorChallenge {
  return (r as TwoFactorChallenge).nextStep === 'verify2fa';
}

export interface TwoFactorEnableResponse {
  method: TwoFactorMethod;
  challengeId: string;
  nextStep: 'confirm';
  /** TOTP only: manual-entry secret and the otpauth:// URI to show as a QR. */
  secret?: string;
  otpauthUri?: string;
}

export interface TwoFactorStatusResponse {
  ok: boolean;
  twoFactorEnabled: boolean;
  method?: TwoFactorMethod;
}

/** GET /auth/sessions — one row per signed-in device. */
export interface AuthSession {
  id: string;
  /** null for sessions created before device labels existed -> "Unknown device". */
  device: string | null;
  platform: string | null;
  appVersion: string | null;
  createdAt: string;
  lastActiveAt: string;
  current: boolean;
}

export interface RevokeSessionsResponse {
  ok: boolean;
  revoked: number;
}

export type FaceLoginPurpose = 'login' | 'recovery';

export interface FaceLoginStartResponse {
  nextStep: 'face';
  preauthToken: string;
  expiresIn: number;
  purpose: FaceLoginPurpose;
}

/** POST /auth/face-login -> tokens (login) or a one-time reset token (recovery). */
export type FaceLoginResult = AuthResponse | { resetToken: string; expiresIn: number };

/** POST /auth/verify-pin — reauthToken (5 min, single use) authorizes PUT /face. */
/** What a verify-pin reauth token is for (POST /auth/verify-pin `scope`). */
export type PinScope = 'face_update' | 'check_in_pin_update';

export interface VerifyPinResponse {
  ok: boolean;
  reauthToken?: string;
  scope?: string;
  expiresIn?: number;
}

export interface RegisterRequest {
  phone: string;
  countryCode: string;
}

export interface RegisterResponse {
  ok: boolean;
  message: string;
  registrationId: string;
  nextStep: 'verifyPhone';
}

export type OtpPurpose = 'phone' | 'email' | 'password_reset';

export interface VerifyOtpRequest {
  registrationId?: string;
  phone?: string;
  countryCode?: string;
  email?: string;
  otp: string;
  purpose: OtpPurpose;
}

export interface VerifyOtpResponse {
  ok: boolean;
  message: string;
  /** Present only when purpose === 'phone' (registration flow). */
  registrationToken?: string;
  /** Present only when purpose === 'email' (registration or reset). */
  nextStep?: 'accountDetails' | 'verifyEmail' | 'reset';
  /** Present when purpose === 'email' during registration (real API returns full AuthResponse). */
  user?: User;
  accessToken?: string;
  refreshToken?: string;
}

export interface AccountDetailsRequest {
  fullName: string;
  dateOfBirth: string;
  pin: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export interface AccountDetailsResponse {
  ok: boolean;
  message: string;
  nextStep: 'verifyEmail';
  /** Backend may return a new registration token for the email verification step. */
  registrationToken?: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

/** Either the email OTP pair or a face-recovery resetToken (single use). */
export interface ResetPasswordRequest {
  email?: string;
  otp?: string;
  resetToken?: string;
  newPassword: string;
}

/** POST /auth/reset-pin — forgot PIN (email OTP) or face recovery. */
export interface ResetPinRequest {
  email?: string;
  otp?: string;
  resetToken?: string;
  newPin: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ChangePinRequest {
  currentPin: string;
  newPin: string;
}

export interface UpdateProfileRequest {
  fullName?: string;
  dateOfBirth?: string;
  address?: string;
}

export interface AddFamilyMemberRequest {
  name: string;
  dateOfBirth: string;
  relationship: string;
}

export interface AddDocumentRequest {
  type: DocumentType;
  label: string;
  /** Optional since Oct 2026 — don't send "PENDING"; verification fills it. */
  number?: string;
  expiresAt?: string | null;
  personId?: string;
}

/** GET /documents/types/supported — build the picker from this, by age. */
export interface SupportedDocumentType {
  type: DocumentType;
  label: string;
  selfieRequired: boolean;
  allowedForMinors: boolean;
  allowedForAdults: boolean;
  minAge: number | null;
  maxAge: number | null;
}

export type DocumentImagePart = 'front' | 'back' | 'selfie';

/** POST /documents/{id}/upload-urls — presigned PUT URLs (15 min). */
export interface DocumentUploadUrls {
  uploads: Partial<Record<DocumentImagePart, { uploadUrl: string; objectKey: string }>>;
  expiresIn: number;
}

export interface SignedImage {
  url: string;
  expiresAt: string;
}

/** GET /documents/{id}/images — null parts show a placeholder; URLs expire. */
export interface DocumentImages {
  front: SignedImage | null;
  back: SignedImage | null;
  selfie: SignedImage | null;
  portrait: SignedImage | null;
}

export type DeleteAccountReason = 'privacy' | 'not_using' | 'few_venues' | 'other';

export interface DeleteAccountRequest {
  confirmation: string;
  pin: string;
  /** Optional, stored without a link to the account. */
  reason?: DeleteAccountReason;
  comment?: string;
}

export interface BiometricConsentRequest {
  accepted: boolean;
}

export interface LogoutRequest {
  refreshToken: string;
}

export interface OkResponse {
  ok: boolean;
  message?: string;
}

// ── Notifications ──────────────────────────────────────────────────────

export type NotificationType = 'booking' | 'document' | 'family' | 'identity' | 'account';

/** Deep-link payload on inbox items and push messages. */
export interface NotificationData {
  type?: NotificationType;
  bookingId?: string;
  documentId?: string;
  personId?: string;
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  type?: string;
  data?: NotificationData | null;
  readAt?: string | null;
}

export interface NotificationCount {
  total: number;
  unread: number;
}

/** Turning a category off stops push only; `security` covers account + identity. */
export interface NotificationPreferences {
  checkin: boolean;
  family: boolean;
  security: boolean;
  document: boolean;
}

export interface PushDevice {
  id: string;
  platform: string;
  createdAt: string;
  lastSeenAt: string;
}

// ── Home / settings data (Oct 2026) ────────────────────────────────────

export type SecuritySuggestionId =
  | 'enroll_face'
  | 'add_document'
  | 'verify_document'
  | 'enable_2fa'
  | 'renew_document'
  | 'change_password'
  | 'review_sessions';

export interface SecurityScore {
  score: number;
  identityStrength: number;
  suggestions: { id: SecuritySuggestionId | string; title: string; points: number; documentId?: string }[];
}

export interface UserStats {
  year: number;
  checkIns: number;
  cities: number;
  /** null when there is no data. */
  avgCheckInMs: number | null;
  minutesSaved: number;
}

export interface AppPreferences {
  language: string;
  region: string | null;
  /** false -> the kiosk refuses face check-in for the account holder. */
  faceCheckInEnabled: boolean;
  shareAnalytics: boolean;
}

/** Hide any channel that is null. */
export interface SupportChannels {
  email: string | null;
  phone: string | null;
  hours: string | null;
  chatUrl: string | null;
}

export type DataExportStatus = 'pending' | 'ready' | 'failed' | 'expired';

export interface DataExport {
  exportId: string;
  status: DataExportStatus;
  readyAt?: string | null;
  expiresAt?: string | null;
  /** BFF path needing the Authorization header — download, never open in a browser. */
  url?: string | null;
  error?: string | null;
}

// ── Liveness / Face (all via BFF /cb/liveness/* and /cb/face/*) ────────

export type LivenessChallenge = 'blink' | 'turn_left' | 'turn_right';

export interface LivenessChallengeResponse {
  success: boolean;
  session_id: string;
  session_token: string;
  challenge_sequence: LivenessChallenge[];
  expires_in_seconds: number;
  step_time_limits: { min_ms: number; max_ms: number };
  ui_copy: Record<LivenessChallenge, string>;
}

export interface LivenessEvidenceRequest {
  challenge: LivenessChallenge;
  step_index: number;
  client_ts_ms: number;
  duration_ms: number;
  // Per KYC guide §4.2: Evidence carries NO image — only step metadata.
  // The only image sent is the final high-res frame at finalize.
}

export interface LivenessEvidenceResponse {
  success: boolean;
  step_accepted: boolean;
  next_challenge?: LivenessChallenge;
  next_instruction?: string;
  status: 'in_progress' | 'failed' | 'passed';
}

export interface LivenessFinalizeResponse {
  success: boolean;
  status: 'passed' | 'failed';
  session_id: string;
  antispoof_score: number;
  message: string;
}

export interface FaceEnrollRequest {
  livenessSessionId?: string;
  sessionToken?: string;
  /** Under-5 members can't run liveness — send the captured photo instead. */
  selfieBase64?: string;
  personId?: string;
}

/** PUT /face — needs X-Reauth-Token from verify-pin (sent by the API layer).
 *  Liveness fields, or selfieBase64 for members under 5. */
export interface FaceUpdateRequest {
  livenessSessionId?: string;
  sessionToken?: string;
  selfieBase64?: string;
  personId?: string;
}

export interface FaceResponse {
  ok: boolean;
  faceEnrolled: boolean;
  faceId?: string;
}

/** Profile picture — presigned URL response (URL expires, see expires_in). */
export interface ProfilePictureResponse {
  url: string;
  expires_in: number;
  updated_at: string | null;
}

// ── Document verification sessions ─────────────────────────────────────

export interface VerificationSessionRequest {
  requestId?: string;
  frontObjectKey?: string;
  backObjectKey?: string;
  selfieObjectKey?: string;
  livenessSessionId?: string;
}

export type VerificationSessionStatus = 'created' | 'completed';
/** 'review' is never returned since Oct 2026 — kept only so old cached
 *  sessions still type-check; treat anything but 'approved' as rejected. */
export type VerificationOutcome = 'approved' | 'rejected' | 'review';

export type DocumentReasonCode =
  | 'DOCUMENT_PROCESSING_ERROR'
  | 'AUTHENTICITY_FAILED'
  | 'DOCUMENT_TYPE_MISMATCH'
  | 'DOCUMENT_UNREADABLE'
  | 'NO_PORTRAIT_IN_DOCUMENT'
  | 'FACE_NOT_ENROLLED'
  | 'DOCUMENT_FACE_MISMATCH'
  | 'PROFILE_MISMATCH'
  | 'DOCUMENT_CHECKS_INCONCLUSIVE';

export interface VerificationSession {
  id: string;
  status: VerificationSessionStatus;
  outcome?: VerificationOutcome;
  reasonCode?: string | null;
  documentId: string;
  createdAt: string;
  completedAt?: string;
  expiresAt?: string;
}

/** Body for POST /document-verification-sessions/{sessionId}/verify
 *  Per REACT_NATIVE_KYC_INTEGRATION_GUIDE.md §6.3:
 *  - frontImageBase64 is required
 *  - selfieImageBase64 for face match (omit for birthCertificate)
 *  - backImageBase64 optional
 */
export interface VerifyDocumentRequest {
  /** Legacy base64 path — prefer presigned uploads (object keys on the session). */
  frontImageBase64?: string;
  backImageBase64?: string;
  selfieImageBase64?: string;
  /** Liveness sessionToken when the session carries a livenessSessionId. */
  sessionToken?: string;
}

/** Response from /verify — synchronous result with outcome + document.
 *  The backend should return all extracted data fields (like Facepe's backend does)
 *  — see BUG_REPORT_BACKEND_EXTRACTED_DATA.md for the full contract. */
export interface VerifyDocumentResponse extends VerificationSession {
  document?: IdentityDocument;
  /** Ready-to-show rejection text; use reasonCode only to pick the action. */
  reasonMessage?: string | null;
  matchScore?: number | null;
  /** Name extracted from the document by Regula (may differ from profile). */
  extractedName?: string | null;
  /** Date of birth extracted from the document (ISO yyyy-mm-dd). */
  extractedDob?: string | null;
  /** Document number extracted by Regula. */
  extractedDocumentNumber?: string | null;
  /** Expiry date extracted by Regula (ISO yyyy-mm-dd). */
  dateOfExpiry?: string | null;
  /** Nationality extracted by Regula (3-letter country code or full name). */
  nationality?: string | null;
  /** Issuing state/province extracted by Regula. */
  issuingState?: string | null;
  /** Portrait photo URL — extracted from the document by backend Regula,
   *  uploaded to object storage, returned as a signed URL. */
  portraitImageUrl?: string | null;
  /** Full document image URL — uploaded to object storage, returned as a signed URL. */
  documentImageUrl?: string | null;
}

// ── Health check ──────────────────────────────────────────────────────

export interface HealthStatus {
  healthy: boolean;
  service?: string;
  version?: string;
}
