import { Router } from 'express';
import { send, pageParams, toCsv, sendCsv } from '../../lib/http.js';
import { requirePermission } from '../../middleware/auth.js';
import { P } from '../auth/permissions.js';
import * as service from './service.js';

export const router = Router();
router.use(requirePermission(P.AUDIT_VIEW));
router.get('/facets', (_req, res) => send(res, service.facets()));
router.get('/export.csv', (req, res) => {
  const rows = service.listAll(req.ctx, req.query);
  sendCsv(res, 'au-lab-audit.csv', toCsv([
    { label: 'Timestamp (UTC)', key: 'timestamp' }, { label: 'User', key: 'userName' }, { label: 'Action', key: 'action' },
    { label: 'Entity', key: 'entity' }, { label: 'Record', key: 'recordCode' }, { label: 'Laboratory', key: 'laboratoryName' },
    { label: 'Previous value', key: 'previous' }, { label: 'New value', key: 'next' }, { label: 'Reason', key: 'reason' },
  ], rows));
});
router.get('/', (req, res) => { const page = pageParams(req.query, { defaultSize: 30 }); const { rows, meta } = service.list(req.ctx, req.query, page); send(res, rows, meta); });
