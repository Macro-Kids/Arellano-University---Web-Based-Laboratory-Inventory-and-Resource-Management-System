import { Router } from 'express';
import { parse, id as idField } from '../../lib/validate.js';
import { send, created, pageParams } from '../../lib/http.js';
import { requirePermission } from '../../middleware/auth.js';
import { P } from '../auth/permissions.js';
import { createSchema, decisionSchema, rejectSchema, releaseSchema, returnSchema } from './schemas.js';
import * as service from './service.js';

export const router = Router();
const rid = (req) => parse(idField('Request id'), req.params.id);

// Every borrowing endpoint needs a signed-in user; fine-grained permission + scope checks live in the service.
router.use(requirePermission(P.BORROW_CREATE, P.BORROW_VIEW_ALL));
router.get('/', (req, res) => { const page = pageParams(req.query); const { rows, meta } = service.list(req.ctx, req.query, page); send(res, rows, meta); });
router.post('/', requirePermission(P.BORROW_CREATE), (req, res) => created(res, service.create(req.ctx, parse(createSchema, req.body))));
router.get('/:id', (req, res) => send(res, service.get(req.ctx, rid(req))));
router.get('/:id/release-plan', requirePermission(P.BORROW_RELEASE), (req, res) => send(res, service.releasePlan(req.ctx, rid(req))));
router.post('/:id/approve', requirePermission(P.BORROW_APPROVE), (req, res) => send(res, service.approve(req.ctx, rid(req), parse(decisionSchema, req.body).reason)));
router.post('/:id/reject', requirePermission(P.BORROW_APPROVE), (req, res) => send(res, service.reject(req.ctx, rid(req), parse(rejectSchema, req.body).reason)));
router.post('/:id/cancel', (req, res) => send(res, service.cancel(req.ctx, rid(req), parse(decisionSchema, req.body).reason)));
router.post('/:id/release', requirePermission(P.BORROW_RELEASE), (req, res) => send(res, service.release(req.ctx, rid(req), parse(releaseSchema, req.body))));
router.post('/:id/return', requirePermission(P.BORROW_RETURN), (req, res) => send(res, service.processReturn(req.ctx, rid(req), parse(returnSchema, req.body))));
router.post('/:id/confirm-return', requirePermission(P.BORROW_CONFIRM_RETURN), (req, res) => send(res, service.confirmReturn(req.ctx, rid(req))));
