import { Router } from 'express';
import { z, parse, str, optStr, oneOf, id as idField } from '../../lib/validate.js';
import { send, created } from '../../lib/http.js';
import { requirePermission } from '../../middleware/auth.js';
import { P } from '../auth/permissions.js';
import * as service from './service.js';

const schema = z.object({
  name: str('Category name', { max: 150 }),
  description: optStr('Description'),
  status: oneOf('Status', ['Active', 'Inactive']).default('Active'),
});
export const router = Router();
router.get('/', (req, res) => send(res, service.list({ includeInactive: req.query.includeInactive === '1' && req.ctx.user.permissions.has(P.CATEGORIES_MANAGE) })));
router.post('/', requirePermission(P.CATEGORIES_MANAGE), (req, res) => created(res, service.create(req.ctx, parse(schema, req.body))));
router.patch('/:id', requirePermission(P.CATEGORIES_MANAGE), (req, res) => send(res, service.update(req.ctx, parse(idField('Category id'), req.params.id), parse(schema, req.body))));
