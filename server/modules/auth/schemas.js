import { z, str, optStr } from '../../lib/validate.js';

export const loginSchema = z.object({
  identifier: str('Username or email', { max: 255 }),
  password: z.string({ error: 'Password is required.' }).min(1, 'Password is required.').max(256),
});
export const profileSchema = z.object({
  firstName: str('First name', { max: 100 }),
  lastName: str('Last name', { max: 100 }),
  email: optStr('Email', { max: 255 }).refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address.'),
});
export const changePasswordSchema = z.object({
  currentPassword: z.string({ error: 'Current password is required.' }).min(1, 'Current password is required.'),
  newPassword: z.string({ error: 'New password is required.' }).min(1, 'New password is required.'),
});
