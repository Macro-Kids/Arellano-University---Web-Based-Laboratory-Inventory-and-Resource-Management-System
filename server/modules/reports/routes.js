import { Router } from 'express';
import { send, toCsv, sendCsv } from '../../lib/http.js';
import { requirePermission } from '../../middleware/auth.js';
import { P } from '../auth/permissions.js';
import { recordAudit } from '../audit/record.js';
import * as service from './service.js';

export const router = Router();
router.use(requirePermission(P.REPORTS_VIEW));
router.get('/:type', (req, res) => {
  const report = service.generate(req.ctx, req.params.type, req.query);
  if (req.query.format === 'csv') {
    recordAudit(req.ctx, { action: 'Report exported', entity: 'System', next: { report: report.type, rows: report.rows.length } });
    return sendCsv(res, `au-lab-${report.type}-${report.today}.csv`, toCsv(report.columns, report.rows));
  }
  send(res, report);
});
