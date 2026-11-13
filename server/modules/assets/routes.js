import { Router } from 'express';
import { parse, id as idField } from '../../lib/validate.js';
import { send, created, pageParams } from '../../lib/http.js';
import { requirePermission } from '../../middleware/auth.js';
import { P } from '../auth/permissions.js';
import { registerAssetSchema, updateAssetSchema, stateSchema } from './schemas.js';
import * as service from './service.js';

export const router = Router();
const assetId = (req) => parse(idField('Asset id'), req.params.id);

router.use(requirePermission(P.ASSETS_VIEW));
router.get('/', (req, res) => { const page = pageParams(req.query); const { rows, meta } = service.list(req.ctx, req.query, page); send(res, rows, meta); });
router.get('/:id', (req, res) => send(res, service.get(req.ctx, assetId(req))));
router.post('/', requirePermission(P.ASSETS_REGISTER), (req, res) => created(res, service.register(req.ctx, parse(registerAssetSchema, req.body))));
router.patch('/:id', requirePermission(P.ASSETS_UPDATE), (req, res) => send(res, service.updateMeta(req.ctx, assetId(req), parse(updateAssetSchema, req.body))));
router.post('/:id/state', requirePermission(P.ASSETS_UPDATE), (req, res) => send(res, service.changeState(req.ctx, assetId(req), parse(stateSchema, req.body))));
