import { z, str, optStr, id, oneOf } from '../../lib/validate.js';
import { ASSIGNABLE_ROLES } from '../auth/permissions.js';

const email = optStr('Email', { max: 255 }).refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address.');
const labIds = z.array(id('Laboratory')).default([]);

export const createUserSchema = z.object({
  username: str('Username', { min: 3, max: 30 }).regex(/^[A-Za-z0-9._-]+$/, 'Username may only contain letters, numbers, dots, dashes and underscores.'),
  firstName: str('First name', { max: 100 }),
  lastName: str('Last name', { max: 100 }),
  email,
  roleId: id('Role'),
  laboratoryIds: labIds,
  password: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
});
export const updateUserSchema = z.object({
  firstName: str('First name', { max: 100 }), lastName: str('Last name', { max: 100 }),
  email, roleId: id('Role'), laboratoryIds: labIds,
});
export const statusSchema = z.object({ status: oneOf('Status', ['Active', 'Inactive']) });
export const resetPasswordSchema = z.object({ password: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()) });
export { ASSIGNABLE_ROLES };
