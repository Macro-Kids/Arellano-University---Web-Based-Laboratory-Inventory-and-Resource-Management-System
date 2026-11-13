import { Router } from 'express';
import { parse } from '../../lib/validate.js';
import { send, created, pageParams } from '../../lib/http.js';
import { requirePermission } from '../../middleware/auth.js';
import { P } from '../auth/permissions.js';
import { createUserSchema, updateUserSchema, statusSchema, resetPasswordSchema } from './schemas.js';
import { id as idField } from '../../lib/validate.js';
import * as service from './service.js';

export const router = Router();
const userId = (req) => parse(idField('User id'), req.params.id);

// Requester picker for coordinators/staff creating a request on someone's behalf (read-only, minimal fields).
router.get('/requesters', requirePermission(P.BORROW_CREATE_FOR_OTHERS), (req, res) =>
  send(res, service.requesters(req.ctx, parse(idField('Laboratory'), req.query.laboratoryId))));

router.use(requirePermission(P.USERS_MANAGE));
router.get('/roles', (_req, res) => send(res, service.listRoles()));
router.get('/', (req, res) => { const page = pageParams(req.query); const { rows, meta } = service.list(req.query, page); send(res, rows, meta); });
router.get('/:id', (req, res) => send(res, service.get(userId(req))));
router.post('/', async (req, res) => created(res, await service.create(req.ctx, parse(createUserSchema, req.body))));
router.patch('/:id', (req, res) => send(res, service.update(req.ctx, userId(req), parse(updateUserSchema, req.body))));
router.post('/:id/status', (req, res) => send(res, service.setStatus(req.ctx, userId(req), parse(statusSchema, req.body).status)));
router.post('/:id/reset-password', async (req, res) => send(res, await service.resetPassword(req.ctx, userId(req), parse(resetPasswordSchema, req.body).password)));
