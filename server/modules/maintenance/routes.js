import { Router } from 'express';
import { parse, id as idField } from '../../lib/validate.js';
import { send, created, pageParams } from '../../lib/http.js';
import { requirePermission } from '../../middleware/auth.js';
import { P } from '../auth/permissions.js';
import { createSchema, progressSchema, completeSchema } from './schemas.js';
import * as service from './service.js';

export const router = Router();
const mid = (req) => parse(idField('Maintenance id'), req.params.id);
router.use(requirePermission(P.MAINTENANCE_VIEW));
router.get('/', (req, res) => { const page = pageParams(req.query); const { rows, meta } = service.list(req.ctx, req.query, page); send(res, rows, meta); });
router.get('/:id', (req, res) => send(res, service.get(req.ctx, mid(req))));
router.post('/', requirePermission(P.MAINTENANCE_MANAGE), (req, res) => created(res, service.create(req.ctx, parse(createSchema, req.body))));
router.patch('/:id', requirePermission(P.MAINTENANCE_MANAGE), (req, res) => send(res, service.updateProgress(req.ctx, mid(req), parse(progressSchema, req.body))));
router.post('/:id/complete', requirePermission(P.MAINTENANCE_MANAGE), (req, res) => send(res, service.complete(req.ctx, mid(req), parse(completeSchema, req.body))));
