# Truepas App — Complete Documentation

> **Truepas** is a React Native (Expo) identity-verification app. Users enroll their face + government documents, manage family-member identities (especially minors), and use the verified identity to check in at partner venues (hotels, theme parks, cruises). This document explains the entire codebase so any new developer can understand it end-to-end.

---

## Table of Contents

1. [What is Truepas?](#1-what-is-truepas)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Environment Setup](#4-environment-setup)
5. [Running the App](#5-running-the-app)
6. [App Navigation Flow](#6-app-navigation-flow)
7. [Screens Reference](#7-screens-reference)
8. [State Management](#8-state-management)
9. [API Layer (Mock + Real)](#9-api-layer-mock--real)
10. [Data Types](#10-data-types)
11. [UI Components Library](#11-ui-components-library)
12. [Theme & Design Tokens](#12-theme--design-tokens)
13. [Forms & Validation](#13-forms--validation)
14. [Security Model](#14-security-model)
15. [Backend Integration Guide](#15-backend-integration-guide)
16. [Known Issues & TODOs](#16-known-issues--todos)

---

## 1. What is Truepas?

Truepas is a digital identity wallet. Core user journeys:

| Journey | Description |
|---|---|
| **Sign up** | Phone → OTP → Account details (name, DOB, PIN) → Biometric consent → Face scan → Verified |
| **Login** | Email/phone + password (returning users) |
| **Identity** | View verification status (face, document, selfie match), recent activity |
| **Documents** | Add / scan / verify government documents (passport, driving license, ID card, green card, birth certificate, US visa) |
| **Family** | Add minor family members (0–17 yrs) with document + optional face enrollment; 18+ rejected |
| **History** | View past venue check-ins (hotels, theme parks, cruises) |
| **Security** | Change password, change PIN, update face, withdraw biometric consent, delete account |
| **Profile** | View personal info, address; edit via support |

**Key rule (PRD):** Face enrollment is mandatory — no skip path. Users cannot access the main app until their face is enrolled.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native 0.86 + Expo SDK 57 |
| Language | TypeScript 6 |
| Routing | Expo Router (file-based) |
| State (auth) | Redux Toolkit + react-redux |
| Server state | TanStack React Query v5 |
| HTTP client | Axios (with token refresh interceptor) |
| Forms | React Hook Form + Zod validation |
| Styling | NativeWind (Tailwind CSS for RN) + inline styles |
| Animations | react-native-reanimated 4 + Animated API |
| Icons | Custom SVG icon system (`components/ui/Icon.tsx`) |
| Fonts | Satoshi (Regular, Medium, Bold) |
| Secure storage | expo-secure-store (Keychain / Keystore) |
| Camera | expo-camera |
| Haptics | expo-haptics |
| Gradients | expo-linear-gradient |

---

## 3. Project Structure

```
truepas-app-1/
├── assets/                     # Images, fonts, onboarding illustrations
│   ├── fonts/                  # Satoshi-Regular/Medium/Bold .ttf
│   ├── images/                 # Logo, SVGs, background images
│   └── onboarding/             # Welcome screen illustrations (1_1.png, 2_1.png, 3_1.png)
│
├── src/
│   ├── api/                    # API layer (mock + real)
│   │   ├── client.ts           # Axios instance with Bearer token + 401 refresh
│   │   ├── endpoints.ts        # Real REST API (same signatures as mock)
│   │   ├── errors.ts           # Error normalization (toApiError)
│   │   ├── index.ts            # Switch: mockApi vs realApi (env-based)
│   │   ├── mock.ts             # Mock API with in-memory store + JSON fixtures
│   │   └── data/               # JSON fixtures (user, documents, family, bookings, etc.)
│   │
│   ├── app/                    # Expo Router screens (file-based routing)
│   │   ├── _layout.tsx         # Root layout (Redux + QueryClient + SafeArea + Toast)
│   │   ├── index.tsx           # Entry gate (redirect based on auth state)
│   │   ├── dev.tsx             # Dev-only playground
│   │   ├── (auth)/             # Auth flow group
│   │   ├── (onboarding)/       # Mandatory face enrollment group
│   │   ├── (tabs)/             # Main app with bottom tabs
│   │   ├── about/              # About Truepas page
│   │   ├── account/delete/     # Delete account flow (4 steps)
│   │   ├── booking/[id].tsx    # Booking detail
│   │   ├── document/           # Document scan/verify flow
│   │   ├── face-update/        # Update face (PIN → camera → success/error)
│   │   ├── family/             # Family detail + add flow
│   │   ├── legal/              # Terms, Privacy Policy, Data Privacy
│   │   ├── notification/       # Age-18 notification
│   │   ├── profile/            # Profile view + edit
│   │   ├── security/           # Security settings, change password/PIN
│   │   └── settings/           # App settings
│   │
│   ├── components/
│   │   ├── layout/             # ScreenContainer, ScreenHeader, TopBar
│   │   └── ui/                 # Reusable UI components (Button, Card, FloatingInput, etc.)
│   │
│   ├── constants/
│   │   └── theme.ts            # Colors, Gradients, Radius, Typography, Elevation, Spacing
│   │
│   ├── features/               # Feature-based hooks, schemas, slices
│   │   ├── auth/               # mutations, schemas (Zod), Redux slice, OtpVerification component
│   │   ├── documents/          # useDocuments, useAddDocument, useRemoveDocument
│   │   ├── family/             # useFamily, useAddFamilyMember, useRemoveFamilyMember, age helpers
│   │   ├── history/            # useBookings, useBooking
│   │   └── legal/              # LegalDocument component
│   │
│   ├── hooks/
│   │   └── useCountdown.ts     # OTP resend countdown
│   │
│   ├── services/
│   │   └── secureStorage.ts    # expo-secure-store wrapper (refresh token)
│   │
│   ├── store/
│   │   └── index.ts            # Redux store config + typed hooks
│   │
│   └── types/
│       └── domain.ts           # All TypeScript domain types + API request/response shapes
│
├── app.json                    # Expo config
├── babel.config.js             # Babel (module-resolver for @/ alias)
├── metro.config.js             # Metro bundler config
├── tailwind.config.js          # NativeWind config
├── tsconfig.json               # TypeScript config (@/* path alias)
└── .env.example                # Environment variables template
```

### Path Alias

The `@/` alias maps to `src/`. Configured in:
- `tsconfig.json` → `paths`
- `babel.config.js` → `babel-plugin-module-resolver`

Example: `import { Button } from '@/components/ui'` → `src/components/ui/index.ts`

---

## 4. Environment Setup

### Prerequisites

- Node.js 18+ (recommended 20)
- npm or yarn
- Expo CLI (`npm install -g expo-cli` or use `npx expo`)
- Android Studio (for Android emulator) or Xcode (for iOS simulator, macOS only)

### Install

```bash
cd truepas-app-1
npm install
```

### Environment Variables

Copy `.env.example` to `.env`:

```bash
# Base URL for the real backend (used when mock is off)
EXPO_PUBLIC_API_URL=https://api.truepas.example

# "true"  → use JSON mock data (default, no backend needed)
# "false" → use real REST API
EXPO_PUBLIC_USE_MOCK_API=true
```

> While developing UI, keep `EXPO_PUBLIC_USE_MOCK_API=true`. The app works fully with mock data.

---

## 5. Running the App

```bash
# Start Metro bundler
npx expo start

# Run on Android emulator
npx expo start --android

# Run on iOS simulator
npx expo start --ios

# Run on web
npx expo start --web

# Clear cache (useful when assets change)
npx expo start -c
```

### TypeScript Check

```bash
npx tsc --noEmit
```

### Lint

```bash
npm run lint
```

---

## 6. App Navigation Flow

```
App Launch
    │
    ▼
index.tsx (entry gate)
    │
    ├── __DEV__ → /dev (playground)
    │
    ├── status !== 'authenticated' → /(auth)/welcome
    │
    ├── !faceEnrolled → /(onboarding)/consent
    │
    └── authenticated + faceEnrolled → /(tabs)
```

### Auth Flow (`(auth)` group)

```
welcome → register → verify-phone → verify-email → account-details
   │                                                        │
   └── login ──→ forgot-password (email → otp → reset)       │
                                                              ▼
                                                    /(onboarding)/consent
```

### Onboarding Flow (`(onboarding)` group) — Mandatory

```
consent → face-scan → face-enrolled → /(tabs)
```

No skip button. User must complete face enrollment to enter the app.

### Main App (`(tabs)` group) — Bottom Tabs

| Tab | Route | Screen |
|---|---|---|
| Home | `/(tabs)/index` | Identity dashboard (verification status, activity) |
| Documents | `/(tabs)/documents` | Document list + add |
| Family | `/(tabs)/family` | Family member list + add |
| History | `/(tabs)/history` | Booking/check-in history |

### Secondary Screens (pushed from tabs)

- `/profile` — Profile view
- `/profile/edit` — Personal info (read-only, contact support to edit)
- `/security` — Security settings
- `/security/change-password` — Change password
- `/security/change-pin` — Change 4-digit PIN
- `/face-update/pin` → `/face-update/camera` → `/face-update/success` — Update face
- `/family/add` (4-step: basic info → document → face-capture/rejected)
- `/family/[id]` — Family member detail
- `/document/select-type` → `/document/scan` → `/document/processing` → `/document/verified` (a rejection: a popup on processing, or `/document/rejected`)
- `/document/[id]` — Document detail
- `/booking/[id]` — Booking detail
- `/settings` — App settings
- `/about` — About Truepas
- `/legal/terms` — Terms of Service
- `/legal/privacy-policy` — Privacy Policy
- `/legal/data-privacy` — Data Privacy
- `/notification/age-18` — Age 18 notification
- `/account/delete` (4-step: index → confirm → processing → success)

---

## 7. Screens Reference

### `(auth)/welcome.tsx`
Onboarding welcome screen with 3 carousel slides explaining Truepas features. Gradient background. "Get Started" → register. "Sign In" → login.

### `(auth)/register.tsx`
Phone number registration. Country code picker (bottom sheet modal with 12 countries). Phone number input. "Send Code" → `useRegister` mutation → verify-phone.

### `(auth)/verify-phone.tsx`
6-digit OTP verification. Uses `OtpVerification` component. Resend countdown (30s). "Verify" → `useVerifyOtp` mutation → verify-email.

### `(auth)/verify-email.tsx`
Email OTP verification (same `OtpVerification` component).

### `(auth)/account-details.tsx`
Full name, date of birth (custom date picker modal with month/day/year scroll), 4-digit PIN. "Continue" → `useCompleteAccountDetails` mutation → dispatches `sessionStarted` to Redux → onboarding.

### `(auth)/login.tsx`
Email/phone + password login. Show/hide password toggle. "Forgot password?" link. "Next" → `api.login` → `sessionStarted`.

### `(auth)/forgot-password.tsx`
3-step flow: Email → OTP → Reset Password. Uses `useForgotPassword`, `useVerifyOtp`, `useResetPassword` mutations.

### `(onboarding)/consent.tsx`
Biometric consent screen. User must agree to face enrollment.

### `(onboarding)/face-scan.tsx`
Face capture camera screen.

### `(onboarding)/face-enrolled.tsx`
Success screen after face enrollment. Dispatches `faceEnrollmentCompleted`. → tabs.

### `(tabs)/index.tsx` — Home
Identity dashboard. Shows verification status (face, document, selfie match), identity summary card, recent activity feed. Uses `useIdentitySummary` query.

### `(tabs)/documents.tsx`
Document list. Each document shows type, label, number, status, match score. "Add Document" → select-type. Uses `useDocuments` query.

### `(tabs)/family.tsx`
Family member list. Each member shows avatar (initials), name, relationship, age, verification badge. "Add Family Member" → family/add. Uses `useFamily` query.

### `(tabs)/history.tsx`
Booking history list. Each booking shows venue image, name, location, dates, status, guests, amount. Uses `useBookings` query.

### `family/add/index.tsx`
Step 1: Basic info (full name, DOB, relationship chips, guardianship consent checkbox). Calculates age band. 18+ → rejected page. 5-17 → document + face. 0-4 → document only.

### `family/add/document.tsx`
Step 2: Document upload/scan. For 0-4: upload only. For 5-17: scan → face-capture. Calls `useAddFamilyMember` on completion.

### `family/add/face-capture.tsx`
Step 3: Face capture for 5-17 age band. Calls `useAddFamilyMember` on capture.

### `family/add/rejected.tsx`
Shown when age ≥ 18. "Family members must be under 18."

### `family/[id].tsx`
Family member detail. Avatar with camera icon (update face). Verification card, documents card. Options menu (edit, update face, manage documents, remove). "Remove member" → `useRemoveFamilyMember` with confirmation.

### `document/select-type.tsx`
Choose document type (passport, driving license, ID card, green card, birth certificate, US visa).

### `document/scan.tsx`
Document scanning camera screen.

### `document/processing.tsx`
Verification in progress (loading animation).

### `document/verified.tsx`
Document verified success screen.

### `document/[id].tsx`
Document detail view.

### `profile/index.tsx`
Profile page with avatar, name, verification badge, personal info, address. Links to edit, security, settings.

### `profile/edit.tsx`
Personal info (read-only). "Contact support to update."

### `security/index.tsx`
Security settings: Change Password, Change PIN, Update Face, Face ID Login toggle, SMS Verification toggle, Biometric Consent (withdraw), Delete Account.

### `security/change-password.tsx`
Current password + new password + confirm. "Update Password" → `useChangePassword` mutation.

### `security/change-pin.tsx`
2-step: Verify current PIN → Create new PIN. Uses `PinPad` component. "Change" → `useChangePin` mutation.

### `face-update/pin.tsx`
PIN verification before face update. Uses `PinPad`. "Verify" → `useVerifyPin` mutation → camera.

### `face-update/camera.tsx`
Face capture camera.

### `face-update/success.tsx`
Face updated success.

### `face-update/error.tsx`
Face update failed.

### `account/delete/index.tsx`
Delete account warning/info.

### `account/delete/confirm.tsx`
Type "DELETE" + enter PIN. "Delete My Account" → `useDeleteAccount` mutation → processing.

### `account/delete/processing.tsx`
Deletion in progress animation.

### `account/delete/success.tsx`
Account deleted. → welcome.

### `settings/index.tsx`
App settings (notifications, language, theme, about, legal links, logout).

### `about/index.tsx`
About Truepas page with logo, tagline, features, mission, contact info.

### `legal/terms.tsx`
Terms of Service (uses `LegalDocument` component).

### `legal/privacy-policy.tsx`
Privacy Policy.

### `legal/data-privacy.tsx`
Data Privacy info.

### `notification/age-18.tsx`
Notification shown when a family member turns 18 (must be removed from family).

### `booking/[id].tsx`
Booking detail with venue image, check-in/check-out, guests, amount, checked-in members.

---

## 8. State Management

### Redux (Auth State)

Only auth state is in Redux. Everything else is handled by React Query.

**Store:** `src/store/index.ts`
```typescript
{
  auth: {
    status: 'unauthenticated' | 'authenticated',
    user: User | null,
    faceEnrolled: boolean,
    biometricConsent: boolean,
  }
}
```

**Slice:** `src/features/auth/slice.ts`

Actions:
| Action | Effect |
|---|---|
| `sessionStarted` | Sets user, status=authenticated, faceEnrolled, biometricConsent. Sets access token in Axios. |
| `biometricConsentGiven` | Sets biometricConsent=true |
| `faceEnrollmentCompleted` | Sets faceEnrolled=true, updates user.faceEnrolled |
| `sessionEnded` | Resets to initial state, clears access token |

**Typed hooks:** `useAppDispatch`, `useAppSelector` (from `src/store`)

### React Query (Server State)

All data fetching and mutations use React Query hooks.

**QueryClient config** (in `_layout.tsx`):
- `retry: 2`
- `staleTime: 60_000` (1 minute)

**Query key conventions:**
| Feature | Keys |
|---|---|
| Auth/User | `['user']` |
| Identity | `['identity', 'summary']` |
| Documents | `['documents']`, `['documents', id]`, `['documents', 'issued']` |
| Family | `['family']`, `['family', id]`, `['family', id, 'activity']` |
| History | `['bookings']`, `['bookings', id]` |

Mutations invalidate relevant query keys on success (e.g., `useAddFamilyMember` invalidates `['family']`).

---

## 9. API Layer (Mock + Real)

### Architecture

```
Screen/Hook
    │
    ▼
api (from @/api/index.ts)
    │
    ├── EXPO_PUBLIC_USE_MOCK_API=true  → mockApi (src/api/mock.ts)
    │                                      └── JSON fixtures (src/api/data/)
    │                                      └── In-memory store for writes
    │
    └── EXPO_PUBLIC_USE_MOCK_API=false → realApi (src/api/endpoints.ts)
                                           └── Axios → REST backend
```

**Key design principle:** `mockApi` and `realApi` have identical function signatures. Switching from mock to real requires only an env change — no code changes.

### Mock API (`src/api/mock.ts`)

- Reads from JSON files in `src/api/data/`
- 450ms simulated latency
- In-memory state for write operations (add/update/delete)
- State resets on app restart (back to JSON fixtures)
- Validates credentials (e.g., `currentPassword` must match, `currentPin` must match)

**JSON fixtures:**
| File | Content |
|---|---|
| `user.json` | Current user profile |
| `identitySummary.json` | Verification status + activity |
| `documents.json` | User's identity documents |
| `issuedDocuments.json` | Government-issued documents |
| `family.json` | Family members list |
| `family-activity.json` | Family member activity log |
| `bookings.json` | Venue check-in history |

### Real API (`src/api/endpoints.ts`)

REST endpoints (update paths to match backend):

| Operation | Method | Path |
|---|---|---|
| Get user | GET | `/user/me` |
| Identity summary | GET | `/identity/summary` |
| List documents | GET | `/documents` |
| Get document | GET | `/documents/:id` |
| Issued documents | GET | `/documents/issued` |
| List family | GET | `/family` |
| Get family member | GET | `/family/:id` |
| Family activity | GET | `/family/:id/activity` |
| List bookings | GET | `/bookings` |
| Get booking | GET | `/bookings/:id` |
| Login | POST | `/auth/login` |
| Register | POST | `/auth/register` |
| Verify OTP | POST | `/auth/verify-otp` |
| Account details | POST | `/auth/account-details` |
| Forgot password | POST | `/auth/forgot-password` |
| Reset password | POST | `/auth/reset-password` |
| Change password | POST | `/auth/change-password` |
| Change PIN | POST | `/auth/change-pin` |
| Verify PIN | POST | `/auth/verify-pin` |
| Delete account | DELETE | `/user/me` |
| Update profile | PUT | `/user/me` |
| Add family member | POST | `/family` |
| Remove family member | DELETE | `/family/:id` |
| Add document | POST | `/documents` |
| Remove document | DELETE | `/documents/:id` |

### Axios Client (`src/api/client.ts`)

- Base URL from `EXPO_PUBLIC_API_URL`
- 15s timeout
- JSON content type
- Request interceptor: adds `Authorization: Bearer <token>`
- Response interceptor: on 401, refreshes token (single-flight), replays original request
- Access token: in-memory only (set by auth slice via `setAccessToken`)
- Refresh token: hardware-backed secure storage (`expo-secure-store`)

### Error Handling (`src/api/errors.ts`)

`toApiError(error)` normalizes Axios errors, network errors, and generic errors into a consistent `{ message }` shape.

---

## 10. Data Types

All types in `src/types/domain.ts`.

### Core Domain Types

```typescript
User {
  id, fullName, email, phone,
  faceEnrolled: boolean,
  biometricConsentAt: string | null
}

IdentitySummary {
  status: 'incomplete' | 'verified',
  face: VerificationStatus,    // 'verified' | 'pending' | 'missing' | 'failed'
  document: VerificationStatus,
  selfieMatch: VerificationStatus,
  activity: ActivityItem[]
}

IdentityDocument {
  id, type: DocumentType, label, number,
  status: VerificationStatus,
  matchScore: number | null,
  addedAt, expiresAt
}

DocumentType = 'passport' | 'drivingLicense' | 'idCard' | 'greenCard' | 'birthCertificate' | 'usVisa'

FamilyMember {
  id, name, relationship, age,
  ageBand: '0-4' | '5-17' | '18+',
  verification: string,
  turning18Soon: boolean
}

Booking {
  id, venue, location, type, image,
  checkIn, checkOut, status,
  guests, amount, checkedInMembers?
}

IssuedDoc {
  id, name, issuer, issuedAt,
  icon, number, status: 'Active' | 'Expired'
}
```

### API Request/Response Types

```typescript
AuthResponse { user, accessToken, refreshToken }
LoginRequest { identifier, password }
RegisterRequest { phone, countryCode }
VerifyOtpRequest { phone?, otp }
AccountDetailsRequest { fullName, dateOfBirth, pin }
ForgotPasswordRequest { email }
ResetPasswordRequest { email, otp, newPassword }
ChangePasswordRequest { currentPassword, newPassword }
ChangePinRequest { currentPin, newPin }
UpdateProfileRequest { fullName?, email?, phone?, dateOfBirth? }
AddFamilyMemberRequest { name, dateOfBirth, relationship }
AddDocumentRequest { type, label, number, expiresAt }
OkResponse { ok: boolean, message?: string }
```

---

## 11. UI Components Library

All reusable components in `src/components/ui/`. Exported via `index.ts`.

### Layout Components (`src/components/layout/`)

| Component | Purpose |
|---|---|
| `ScreenContainer` | Wraps every screen. Handles scroll, safe area, gradient background. |
| `ScreenHeader` | Header with back button + title. |
| `TopBar` | Minimal top bar with title. |

### UI Components (`src/components/ui/`)

| Component | Purpose |
|---|---|
| `Button` | Primary button with loading state, variants (default, danger). |
| `Card` | White rounded card container. |
| `FloatingInput` | Text input with floating label. Supports error, rightSlot, gradient. |
| `Icon` | SVG icon from `iconPaths.tsx`. 30+ icons. |
| `OtpRow` | Visual OTP digit boxes (displays code). |
| `PinPad` | Numeric keypad for PIN entry. |
| `PinDots` | PIN dots indicator (filled/unfilled). |
| `ProgressTrack` | Progress bar for multi-step flows. |
| `Stepper` | Step indicator (e.g., 1 of 4). |
| `Chip` / `ChipRow` | Selectable chips (e.g., relationship selector). |
| `CheckboxRow` | Checkbox with label. |
| `Toggle` | iOS-style toggle switch. |
| `Pill` | Status pill (active, gray, etc.). |
| `ListItem` | List row with title, subtitle, chevron. |
| `SectionTitle` | Section header text. |
| `InfoBanner` | Info/warning banner with icon. |
| `Skeleton` | Loading skeleton placeholder. |
| `EmptyState` | Empty list state with icon + message. |
| `ErrorState` | Error state with retry button. |
| `Avatar` | User avatar with initials or image. |
| `BottomSheet` | Bottom sheet modal. |
| `Toast` / `ToastProvider` | Toast notifications (success, error, info). |
| `AnimatedCard` | Card with entrance animation. |
| `NeuButton` / `NeuElevatedView` / `NeuPitView` | Neumorphic UI components. |
| `DocIllustration` | Document type illustration. |
| `AppText` | Text component with Satoshi font. |
| SVG components | `CarClaySvg`, `GlobeClaySvg`, `PassportClaySvg`, `StatueClaySvg`, `StatueOfLibertySvg`, `UsFlagClaySvg` |

---

## 12. Theme & Design Tokens

File: `src/constants/theme.ts`

### Colors

| Token | Value | Usage |
|---|---|---|
| `primary` | `#08B6FC` | Brand blue |
| `primaryPressed` | `#0692ca` | Pressed state |
| `primaryDark` | `#034965` | Dark blue text |
| `primaryLight` | `#84dbfe` | Light blue gradient end |
| `surface` | `#e6f8ff` | Light blue surface |
| `ink` | `#000000` | Primary text |
| `textMuted` | `#666666` | Secondary text |
| `textFaint` | `#8a8a8a` | Faint text (labels) |
| `borderInput` | `#e0e0e0` | Input borders |
| `success` | `#059669` | Success states |
| `error` | `#dc2626` | Error states |
| `warning` | `#b45309` | Warning states |

### Gradients

| Token | Colors |
|---|---|
| `brand` | `['#08B6FC', '#84dbfe']` |
| `welcome` | `['#84dbfe', '#08B6FC', '#0692ca']` |
| `identityCard` | `['#0692ca', '#0692ca']` |

### Radius

`card: 16, btn: 12, input: 8, chip: 8, pill: 4, sheet: 20, welcome: 32`

### Typography

| Token | Size | Weight |
|---|---|---|
| `caption` | 12 | 400 |
| `bodySmall` | 14 | 400 |
| `body` | 16 | 400 |
| `bodyLarge` | 18 | 600 |
| `headingSmall` | 20 | 700 |
| `heading` | 24 | 700 |
| `headingLarge` | 32 | 700 |
| `display` | 40 | 700 |

### Elevation (Shadows)

`none, small, medium, large, floating` — each with `elevation`, `shadowColor`, `shadowOpacity`, `shadowRadius`, `shadowOffset`.

### Spacing

`xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 40, massive: 48`

### NativeWind (Tailwind)

Most styling uses Tailwind classes via NativeWind:
```tsx
<View className="flex-1 px-6 pt-4 bg-white">
  <Text className="text-[14px] font-bold text-primary">Hello</Text>
</View>
```

Custom theme colors are mapped in `tailwind.config.js` so `text-primary`, `bg-surface`, etc. work.

---

## 13. Forms & Validation

### React Hook Form + Zod

Every form uses `react-hook-form` with `zodResolver`.

**Schemas** (`src/features/auth/schemas.ts`):

| Schema | Fields | Validation |
|---|---|---|
| `loginSchema` | identifier, password | identifier: 3-254 chars; password: 8-128 chars |
| `phoneSchema` | phone | Regex: 7-17 digits/parens/dashes/spaces |
| `accountDetailsSchema` | fullName, dateOfBirth, pin | fullName: 2-100 chars, letters only; DOB: MM/DD/YYYY; PIN: 4 digits |

**Usage pattern:**
```tsx
const { control, handleSubmit } = useForm<LoginForm>({
  resolver: zodResolver(loginSchema),
  defaultValues: { identifier: '', password: '' },
});

<Controller
  control={control}
  name="identifier"
  render={({ field: { onChange, value }, fieldState }) => (
    <FloatingInput
      label="E-mail/Mobile Number"
      value={value}
      onChangeText={onChange}
      error={fieldState.error?.message}
    />
  )}
/>
```

---

## 14. Security Model

### Authentication Flow

1. User logs in → `api.login()` returns `{ user, accessToken, refreshToken }`
2. `sessionStarted` action stores user in Redux + sets `accessToken` in Axios (in-memory)
3. `refreshToken` stored in `expo-secure-store` (hardware-backed Keychain/Keystore)
4. On 401 response → Axios interceptor auto-refreshes token (single-flight) → replays request
5. On logout/delete → `sessionEnded` clears token + secure storage

### PIN Security

- 4-digit PIN set during account-details step
- Required for face updates (`/face-update/pin`)
- Required for account deletion
- Can be changed via `/security/change-pin` (verify current → create new)

### Biometric Consent

- User must consent before face enrollment (onboarding)
- Consent status tracked in Redux (`biometricConsent`)
- Can be withdrawn via Security settings (disables face features)

### Security Best Practices Applied

- Access token: in-memory only, never persisted to storage
- Refresh token: hardware-backed secure storage
- Bearer token auto-attached to all API requests
- Single-flight 401 refresh (no token refresh storms)
- Zod validation at form level (injection defense)
- No secrets in code or AsyncStorage

---

## 15. Backend Integration Guide

### Dev Backend Services

The Truepas dev backend runs on AWS EKS with a microservice architecture. The mobile app talks to two public services:

| Service | Base URL | Health Check | Purpose |
|---|---|---|---|
| **customer-app-bff** | `https://api.dev.truepas.com/cb` | `/health` | BFF gateway — auth, user, family, documents, bookings, profile, security |
| **liveness-service** | `https://api.dev.truepas.com/ls` | `/health` | Face enrollment, face verification, face update, liveness check |

Internal services (EKS-only, not accessible externally):
- `customer-account-service` (port 8017) — user accounts
- `identity-proofing-service` (port 8014) — identity verification
- `notification-service` (port 8013) — notifications
- `checkin-consent-service` (port 8012) — check-in consent
- `kiosk-service` (port 8011) — kiosk
- `merchant-account-service` (port 8018) — merchant accounts
- `event-relay-service` (port 8019) — events
- `service-auth-service` (port 8020) — service auth

### Environment Variables

```bash
# .env file
EXPO_PUBLIC_API_URL=https://api.dev.truepas.com/cb          # BFF
EXPO_PUBLIC_LIVENESS_URL=https://api.dev.truepas.com/ls      # Liveness
EXPO_PUBLIC_USE_MOCK_API=false                               # Use real API
EXPO_PUBLIC_FALLBACK_TO_MOCK=true                            # Fall back to mock on 503
```

| Variable | Values | Effect |
|---|---|---|
| `EXPO_PUBLIC_USE_MOCK_API` | `true` (default) / `false` | `true` = JSON mock, `false` = real REST API |
| `EXPO_PUBLIC_FALLBACK_TO_MOCK` | `true` / `false` | If `true`, 503/network errors fall back to mock data |
| `EXPO_PUBLIC_API_URL` | URL | BFF base URL |
| `EXPO_PUBLIC_LIVENESS_URL` | URL | Liveness service base URL |
| `EXPO_PUBLIC_LIVENESS_CHALLENGE_FALLBACK` | `false` (default) / `true` | Liveness is Regula Face SDK liveness; a server not on Regula (503 `REGULA_LIVENESS_DISABLED`) fails the check. `true` = run the older ML Kit challenge on such a server instead (temporary; mock mode needs it) |

### Two Axios Clients

| Client | File | Base URL | Used for |
|---|---|---|---|
| `apiClient` | `src/api/client.ts` | `EXPO_PUBLIC_API_URL` | All BFF calls (auth, user, family, documents, bookings) |
| `livenessClient` | `src/api/client.ts` | `EXPO_PUBLIC_LIVENESS_URL` | Face operations (enroll, verify, update) |

Both share:
- In-memory access token (set by auth slice)
- Bearer token injection (request interceptor)
- Single-flight 401 refresh with request replay (response interceptor)
- 15s timeout, JSON content type

### Health Checks

Use `src/api/health.ts`:

```typescript
import { checkAllHealth } from '@/api/health';

const { bff, liveness } = await checkAllHealth();
// bff: { healthy: true, service: 'truepass-customer-app-bff', version: '1.0.0' }
// liveness: { healthy: true, service: 'liveness-service' }
```

The dev screen (`/dev`) shows live backend status indicators.

### Error Handling

`src/api/errors.ts` provides `toApiError(error)` which normalizes errors:

| Error | Code | Message | Retryable |
|---|---|---|---|
| 503 | `SERVICE_UNAVAILABLE` | "Backend service is starting up. Please try again in a moment." | Yes |
| No response | `NETWORK` | "Cannot reach the server. Check your internet connection." | Yes |
| Timeout | `TIMEOUT` | "Request timed out. Please try again." | Yes |
| 401 | `UNAUTHORIZED` | "Your session expired. Please log in again." | No |
| 429 | `RATE_LIMITED` | "Too many attempts. Please wait and try again." | Yes |
| 5xx | `SERVER` | "Something went wrong on our side. Please retry." | Yes |
| 4xx | `REQUEST` | Server message or "Request failed." | No |

`isBackendDown(error)` returns `true` for 503/network errors (used by fallback logic).

### Mock Fallback

When `EXPO_PUBLIC_FALLBACK_TO_MOCK=true` and the real API returns 503 or a network error, the call is automatically retried against `mockApi`. This allows UI development to continue even when the backend is down.

Set `EXPO_PUBLIC_FALLBACK_TO_MOCK=false` for strict real-only mode (errors surface to the user).

### When the API spec arrives:

1. **Update endpoint paths** in `src/api/endpoints.ts` to match the backend's actual routes.
2. **Verify request/response shapes** match `src/types/domain.ts`. If the backend uses different field names, either:
   - Ask backend team to match these shapes, OR
   - Add a mapping layer in `endpoints.ts`
3. **Test each flow:**
   - Login → check `AuthResponse` shape
   - Register → check `OkResponse`
   - OTP → check `OkResponse`
   - Family add/remove → check `FamilyMember` shape
   - Document add/remove → check `IdentityDocument` shape
   - Face enroll/verify/update → check `FaceResponse` shape
4. **Token refresh:** Ensure backend implements `POST /auth/refresh` returning `{ accessToken, refreshToken }`.

### Mock API → Real API mapping

Every function in `mockApi` has a 1:1 counterpart in `realApi`:

| Mock function | Real endpoint | Client |
|---|---|---|
| `mockApi.login(payload)` | `POST /auth/login` | `apiClient` |
| `mockApi.register(payload)` | `POST /auth/register` | `apiClient` |
| `mockApi.verifyOtp(payload)` | `POST /auth/verify-otp` | `apiClient` |
| `mockApi.getFamily()` | `GET /family` | `apiClient` |
| `mockApi.addFamilyMember(payload)` | `POST /family` | `apiClient` |
| `mockApi.removeFamilyMember(id)` | `DELETE /family/:id` | `apiClient` |
| `mockApi.getDocuments()` | `GET /documents` | `apiClient` |
| `mockApi.addDocument(payload)` | `POST /documents` | `apiClient` |
| `mockApi.enrollFace(payload)` | `POST /enroll` | `livenessClient` |
| `mockApi.verifyFace(payload)` | `POST /verify` | `livenessClient` |
| `mockApi.updateFace(payload)` | `POST /update` | `livenessClient` |
| ... | ... | ... |

No screen or hook needs to change — they all call `api.*` which routes to mock or real based on env.

---

## 16. Known Issues & TODOs

### Known TypeScript Errors (pre-existing, not blocking)

| File | Issue |
|---|---|
| `(tabs)/_layout.tsx` | expo-router bottom-tabs type mismatch with `@react-navigation/bottom-tabs` |
| `(tabs)/documents.tsx`, `family.tsx`, `index.tsx` | Image `pointerEvents` prop not in type |
| `booking/[id].tsx` | Index signature for venue image map |
| `profile/index.tsx` | `/settings` not in typed routes |
| `NeuPitView.tsx` | Missing `Platform` import |
| `OtpVerification.tsx` | Reanimated `SharedValue` style typing |

### TODO

- [ ] Update endpoint paths in `endpoints.ts` when API spec arrives (currently guessed)
- [ ] Wire document scan/verify flow to real API (`useAddDocument`)
- [ ] Wire profile edit to `useUpdateProfile` (currently read-only)
- [ ] Implement camera capture with `expo-camera` (currently placeholder screens)
- [ ] Wire face scan screens to `useEnrollFace` / `useUpdateFace` mutations
- [ ] Implement file upload for documents
- [ ] Add push notifications
- [ ] Add offline support (React Query persistence)
- [ ] Add deep linking for OTP auto-fill
- [ ] Add biometric authentication (Face ID / Touch ID) for app unlock
- [ ] Verify CORS settings for web platform dev

---

## Quick Reference

### Common imports

```typescript
// UI components
import { Button, Card, FloatingInput, Icon, Pill, SectionTitle, Toggle } from '@/components/ui';

// Layout
import { ScreenContainer, Spacer } from '@/components/layout/ScreenContainer';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { TopBar } from '@/components/layout/TopBar';

// Theme
import { Colors } from '@/constants/theme';

// Redux
import { useAppDispatch, useAppSelector } from '@/store';
import { sessionStarted, sessionEnded } from '@/features/auth/slice';

// API hooks
import { useFamily, useAddFamilyMember } from '@/features/family/hooks';
import { useDocuments, useAddDocument } from '@/features/documents/hooks';
import { useBookings } from '@/features/history/hooks';
import { useLogin, useRegister, useVerifyOtp } from '@/features/auth/mutations';

// Types
import type { User, FamilyMember, IdentityDocument } from '@/types/domain';

// Routing
import { useRouter } from 'expo-router';
const router = useRouter();
router.push('/path');
router.back();
router.dismissTo('/path');
```

### Adding a new screen

1. Create file in `src/app/` (e.g., `src/app/my-feature/index.tsx`)
2. Use `ScreenContainer` as wrapper
3. Use `useQuery` / `useMutation` hooks for data
4. Add types to `src/types/domain.ts` if needed
5. Add mock data to `src/api/mock.ts` + JSON fixture
6. Add real endpoint to `src/api/endpoints.ts`

### Adding a new API operation

1. Add request/response types to `src/types/domain.ts`
2. Add function to `mockApi` in `src/api/mock.ts`
3. Add function to `realApi` in `src/api/endpoints.ts` (same signature)
4. Create a `useMutation` or `useQuery` hook in the relevant `features/*/hooks.ts` or `features/auth/mutations.ts`
5. Use the hook in the screen

---

*This documentation was generated for the Truepas React Native app. Last updated: 2025.*
