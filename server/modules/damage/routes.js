import { Router } from 'express';
import { parse } from '../../lib/validate.js';
import { send, created, pageParams } from '../../lib/http.js';
import { requirePermission } from '../../middleware/auth.js';
import { P } from '../auth/permissions.js';
import { damageSchema } from './schemas.js';
import * as service from './service.js';

export const router = Router();
router.get('/', requirePermission(P.MAINTENANCE_VIEW, P.DAMAGE_RECORD), (req, res) => { const page = pageParams(req.query); const { rows, meta } = service.list(req.ctx, req.query, page); send(res, rows, meta); });
router.post('/', requirePermission(P.DAMAGE_RECORD), (req, res) => { service.record(req.ctx, parse(damageSchema, req.body)); created(res, { ok: true }); });
