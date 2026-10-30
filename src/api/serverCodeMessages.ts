/** User-facing text for backend codes whose server `message` is too terse.
 *  Codes not listed here use the server message or the status fallback
 *  (errors.ts toApiError). No imports, so it runs under `node --test`. */
export const SERVER_CODE_MESSAGES: Record<string, string> = {
  ACCOUNT_EXISTS: 'An account already exists with these details. Sign in instead.',
  INVALID_CREDENTIALS: 'Email/phone or password is incorrect.',
  REAUTH_REQUIRED: 'For your security, enter your PIN again to continue.',
  TWO_FACTOR_INVALID: 'That code is wrong or has expired. Try again.',
  TWO_FACTOR_LOCKED: 'Too many wrong codes. Start signing in again.',
  PIN_INVALID: 'Incorrect PIN.',
  FACE_NOT_MATCHED: "We couldn't sign you in with your face.",
  BOOKING_NOT_EDITABLE: "This booking can't be changed any more.",
  RESERVATION_LIMIT: 'You have reached the limit of 50 upcoming reservations.',
  FAMILY_MEMBER_EXISTS: 'This family member has already been added.',
  FACE_MISMATCH: "This face doesn't match the one registered for this person, so nothing was changed.",
  FACE_NOT_DETECTED: "We couldn't find a face in the capture. Face the camera in good light and try again.",
  FACE_ALREADY_ENROLLED: 'A face is already set up. Use Update face to change it.',
  // Face enrollment (customer-app-bff enroll_face): an unreadable image is
  // never reported as "no face".
  IMAGE_UNDECODABLE: "This photo couldn't be read. Please take it again.",
  // An older face service can't say which: no face, or unreadable.
  IMAGE_NOT_USABLE: "This photo couldn't be used: it had no clear face or couldn't be read. Please take it again.",
  IMAGE_TOO_LARGE: 'This photo is too large to upload. Please take it again.',
  FACE_SERVICE_UNAVAILABLE: "Face setup isn't available right now and nothing was saved. Please try again shortly.",
  ENROLLMENT_RESULT_UNKNOWN: "We couldn't confirm whether the face was saved.",
  ENROLLMENT_NOT_SAVED: "The face wasn't saved. Please try again.",
  FAMILY_MEMBER_NOT_FOUND: 'This family member is no longer on your account.',
};
