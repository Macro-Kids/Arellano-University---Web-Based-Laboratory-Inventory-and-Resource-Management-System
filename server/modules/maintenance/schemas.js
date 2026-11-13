import { z, str, optStr, id, oneOf, CONDITIONS } from '../../lib/validate.js';
export const createSchema = z.object({
  assetId: id('Asset'), reportedIssue: str('Reported issue', { min: 3, max: 2000 }),
  maintenanceAction: optStr('Planned action'), responsiblePerson: str('Responsible person', { max: 200 }), remarks: optStr('Remarks'),
});
export const progressSchema = z.object({
  maintenanceAction: optStr('Action'), responsiblePerson: str('Responsible person', { max: 200 }),
  status: oneOf('Status', ['Open', 'In Progress']), remarks: optStr('Remarks'),
});
export const completeSchema = z.object({
  maintenanceAction: str('Work performed', { min: 3, max: 2000 }),
  resultCondition: oneOf('Resulting condition', CONDITIONS),
  resultStatus: oneOf('Resulting status', ['Available', 'Under Inspection', 'Retired']).default('Available'),
  remarks: optStr('Remarks'),
});
