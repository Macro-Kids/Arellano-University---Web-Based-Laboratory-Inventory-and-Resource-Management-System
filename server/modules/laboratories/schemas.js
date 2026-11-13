import { z, str, optStr, oneOf } from '../../lib/validate.js';
export const labSchema = z.object({
  name: str('Laboratory name', { max: 150 }),
  type: str('Laboratory type', { max: 100 }),
  location: optStr('Location', { max: 255 }),
  description: optStr('Description'),
  status: oneOf('Status', ['Operational', 'Inactive']).default('Operational'),
});
