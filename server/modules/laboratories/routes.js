import { Router } from 'express';
import { parse, id as idField } from '../../lib/validate.js';
import { send, created } from '../../lib/http.js';
import { requirePermission } from '../../middleware/auth.js';
import { P } from '../auth/permissions.js';
import { labSchema } from './schemas.js';
import * as service from './service.js';

export const router = Router();
router.get('/', (req, res) => send(res, service.list(req.ctx)));
router.post('/', requirePermission(P.LABS_MANAGE), (req, res) => created(res, service.create(req.ctx, parse(labSchema, req.body))));
router.patch('/:id', requirePermission(P.LABS_MANAGE), (req, res) => send(res, service.update(req.ctx, parse(idField('Laboratory id'), req.params.id), parse(labSchema, req.body))));
