import { z } from 'zod';

import { cleanName, nameError } from '@/features/names/nameRules';
import { ADULT_AGE, ageFromDob } from '@/utils/age';

/** Input validation at the trust boundary (OWASP A03 — injection defense in depth). */
export const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(3, 'Enter your email or mobile number')
    .max(254, 'Too long'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128, 'Too long'),
});

export const phoneSchema = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^[0-9()\-\s+]{7,17}$/, 'Enter a valid phone number'),
});

/** New-password policy — shared by registration, reset and change so all
 *  three enforce identical complexity before hitting the API. */
export const newPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Too long')
  .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character');

export const accountDetailsSchema = z.object({
  // The same rule customer-account-service applies (any script, initials,
  // apostrophes, hyphens); the value submitted is the cleaned one.
  fullName: z
    .string()
    .transform(cleanName)
    .superRefine((value, ctx) => {
      const problem = nameError(value);
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    }),
  dateOfBirth: z
    .string()
    .trim()
    .regex(/^(0[1-9]|1[0-2])\/(0[1-9]|[12][0-9]|3[01])\/(19|20)\d{2}$/, 'Use MM/DD/YYYY')
    .refine((dob) => Number.isFinite(ageFromDob(dob)), 'Enter a valid date')
    .refine((dob) => !(ageFromDob(dob) < 0), 'Date of birth must be in the past')
    .refine((dob) => !(ageFromDob(dob) < ADULT_AGE), `You must be ${ADULT_AGE} or older to create an account`),
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
  email: z
    .string()
    .trim()
    .min(1, 'Email is required')
    .email('Enter a valid email address')
    .max(254, 'Too long'),
  password: newPasswordSchema,
  confirmPassword: z.string().min(1, 'Confirm your password'),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export type LoginForm = z.infer<typeof loginSchema>;
export type PhoneForm = z.infer<typeof phoneSchema>;
export type AccountDetailsForm = z.infer<typeof accountDetailsSchema>;
