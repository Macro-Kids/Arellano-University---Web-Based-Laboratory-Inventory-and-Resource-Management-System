import { Router } from 'express';
import { parse, id as idField } from '../../lib/validate.js';
import { send, created, pageParams } from '../../lib/http.js';
import { requirePermission } from '../../middleware/auth.js';
import { P } from '../auth/permissions.js';
import { createItemSchema, updateItemSchema, movementSchema, archiveSchema } from './schemas.js';
import * as service from './service.js';

export const router = Router();
const itemId = (req) => parse(idField('Item id'), req.params.id);

router.use(requirePermission(P.INVENTORY_VIEW));
router.get('/', (req, res) => { const page = pageParams(req.query); const { rows, meta } = service.search(req.ctx, req.query, page); send(res, rows, meta); });
router.get('/lookup', (req, res) => send(res, service.lookup(req.ctx, req.query)));
router.get('/movements', (req, res) => { const page = pageParams(req.query); const { rows, meta } = service.movements(req.ctx, req.query, page); send(res, rows, meta); });
router.get('/:id', (req, res) => send(res, service.get(req.ctx, itemId(req))));
router.get('/:id/transactions', (req, res) => { const page = pageParams(req.query, { defaultSize: 15 }); const { rows, meta } = service.history(req.ctx, itemId(req), page); send(res, rows, meta); });
router.get('/:id/audit', (req, res) => send(res, service.auditTrail(req.ctx, itemId(req))));

// Writes: the route checks the permission BEFORE validating input; the service re-checks (defence in depth).
router.post('/', requirePermission(P.INVENTORY_CREATE), (req, res) => created(res, service.create(req.ctx, parse(createItemSchema, req.body))));
router.patch('/:id', requirePermission(P.INVENTORY_UPDATE), (req, res) => send(res, service.update(req.ctx, itemId(req), parse(updateItemSchema, req.body))));
router.post('/:id/archive', requirePermission(P.INVENTORY_ARCHIVE), (req, res) => send(res, service.archive(req.ctx, itemId(req), parse(archiveSchema, req.body).reason)));
router.post('/:id/restore', requirePermission(P.INVENTORY_ARCHIVE), (req, res) => send(res, service.restore(req.ctx, itemId(req))));
router.post('/:id/movements', requirePermission(P.STOCK_MOVE, P.STOCK_ADJUST), (req, res) => send(res, service.moveStock(req.ctx, itemId(req), parse(movementSchema, req.body))));
