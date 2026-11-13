// -----------------------------------------------------------------------------
// maintenance/service.js — UC-012 / FR-021 / FR-022 / BR-005 / RA-015.
// Logging maintenance sets the asset to "Under Maintenance" (not borrowable);
// completing it sets the asset's resulting status + condition. Both in ONE transaction.
// -----------------------------------------------------------------------------
import { inTransaction } from '../../db/connection.js';
import { notFound, ruleViolation } from '../../lib/errors.js';
import { pageMeta } from '../../lib/http.js';
import { assertLab, labFilter, require as requirePerm } from '../../lib/scope.js';
import { nowIso } from '../../lib/time.js';
import { codes } from '../../lib/codes.js';
import { recordAudit } from '../audit/record.js';
import { P } from '../auth/permissions.js';
import * as assetRepo from '../assets/repo.js';
import { applyAssetState } from '../assets/state.js';
import * as repo from './repo.js';

const dto = (m) => (m ? { ...m, code: codes.maintenance(m.id) } : m);
function load(ctx, id) {
  const m = repo.getById(id);
  if (!m) throw notFound('Maintenance record');
  assertLab(ctx, m.laboratoryId);
  return m;
}

export function list(ctx, query, page) {
  const scope = labFilter(ctx, 'a.laboratory_id', Number(query.laboratoryId) || null);
  const base = [scope.sql], baseParams = [...scope.params];
  if (query.assetId) { base.push('m.asset_id = ?'); baseParams.push(Number(query.assetId)); }
  const where = [...base], params = [...baseParams];
  if (['Open', 'In Progress', 'Completed'].includes(query.status)) { where.push('m.maintenance_status = ?'); params.push(query.status); }
  const { total, rows } = repo.query({ where: where.join(' AND '), params, limit: page.pageSize, offset: page.offset });
  return { rows: rows.map(dto), meta: { ...pageMeta(total, page), statusCounts: repo.statusCounts(base.join(' AND '), baseParams) } };
}
export const get = (ctx, id) => dto(load(ctx, id));

export function create(ctx, input) {
  requirePerm(ctx, P.MAINTENANCE_MANAGE);
  const asset = assetRepo.getById(input.assetId);
  if (!asset) throw notFound('Asset');
  assertLab(ctx, asset.laboratoryId);
  if (['Borrowed', 'Lost', 'Retired'].includes(asset.status)) throw ruleViolation(`${asset.tag} is ${asset.status.toLowerCase()} and cannot be sent for maintenance.`);
  if (assetRepo.openMaintenanceFor(asset.id)) throw ruleViolation(`${asset.tag} already has an open maintenance record.`);
  const id = inTransaction(() => {
    const newId = Number(repo.insert({ ...input, now: nowIso() }));
    recordAudit(ctx, { action: 'Maintenance logged', entity: 'Maintenance Record', recordId: newId, laboratoryId: asset.laboratoryId, next: { asset: asset.tag, issue: input.reportedIssue, responsible: input.responsiblePerson } });
    applyAssetState(ctx, asset, { status: 'Under Maintenance', reason: `Maintenance logged: ${input.reportedIssue}` });
    return newId;
  });
  return get(ctx, id);
}

export function updateProgress(ctx, id, input) {
  requirePerm(ctx, P.MAINTENANCE_MANAGE);
  const m = load(ctx, id);
  if (m.status === 'Completed') throw ruleViolation('This maintenance record is already completed and cannot be edited.');
  inTransaction(() => {
    repo.updateProgress(id, input);
    recordAudit(ctx, { action: 'Maintenance updated', entity: 'Maintenance Record', recordId: id, laboratoryId: m.laboratoryId,
      previous: { status: m.status, action: m.maintenanceAction, responsible: m.responsiblePerson }, next: { status: input.status, action: input.maintenanceAction, responsible: input.responsiblePerson } });
  });
  return get(ctx, id);
}

export function complete(ctx, id, input) {
  requirePerm(ctx, P.MAINTENANCE_MANAGE);
  const m = load(ctx, id);
  if (m.status === 'Completed') throw ruleViolation('This maintenance record is already completed.');
  if (input.resultStatus === 'Available' && ['Damaged', 'Non-functional'].includes(input.resultCondition)) {
    throw ruleViolation('A damaged or non-functional asset cannot be returned to service as Available. Choose Retired or Under Inspection, or fix the condition.');
  }
  inTransaction(() => {
    repo.complete(id, { maintenanceAction: input.maintenanceAction, remarks: input.remarks ?? m.remarks, now: nowIso() });
    const asset = assetRepo.getById(m.assetId);
    applyAssetState(ctx, asset, { status: input.resultStatus, condition: input.resultCondition, reason: `Maintenance completed: ${input.maintenanceAction}` });
    recordAudit(ctx, { action: 'Maintenance completed', entity: 'Maintenance Record', recordId: id, laboratoryId: m.laboratoryId, previous: { status: m.status }, next: { status: 'Completed', assetStatus: input.resultStatus, assetCondition: input.resultCondition }, reason: input.maintenanceAction });
  });
  return get(ctx, id);
}
