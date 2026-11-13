// -----------------------------------------------------------------------------
// services/index.js — one thin function per API endpoint. Pages never build URLs
// or call fetch themselves, so an endpoint change is a one-line fix HERE.
// Lists return { rows, meta }; single records return the record itself.
// -----------------------------------------------------------------------------
import { api } from '../core/api.js';

const list = async (path, q) => { const r = await api.get(path, q); return { rows: r.data, meta: r.meta }; };
const one = async (promise) => (await promise).data;

export const auth = {
  login: (identifier, password) => one(api.post('/auth/login', { identifier, password })),
  logout: () => api.post('/auth/logout'),
  me: () => one(api.get('/auth/me')),
  updateProfile: (b) => one(api.patch('/auth/me', b)),
  changePassword: (b) => api.post('/auth/change-password', b),
  demoAccounts: () => one(api.get('/auth/demo-accounts')),
};
export const system = {
  meta: () => one(api.get('/system/meta')),
  diagnostics: () => one(api.get('/system/diagnostics')),
  integrity: () => one(api.get('/system/integrity')),
  backups: () => one(api.get('/system/backups')),
  createBackup: () => one(api.post('/system/backups')),
  backupUrl: (name) => api.url(`/system/backups/${encodeURIComponent(name)}/download`),
  clientLog: (b) => api.post('/system/client-log', b),
};
export const dashboard = { get: (q) => one(api.get('/dashboard', q)), notifications: () => one(api.get('/notifications')) };
export const labsApi = { list: () => one(api.get('/laboratories')), create: (b) => one(api.post('/laboratories', b)), update: (id, b) => one(api.patch(`/laboratories/${id}`, b)) };
export const categoriesApi = { list: (q) => one(api.get('/categories', q)), create: (b) => one(api.post('/categories', b)), update: (id, b) => one(api.patch(`/categories/${id}`, b)) };
export const usersApi = {
  list: (q) => list('/users', q), roles: () => one(api.get('/users/roles')), get: (id) => one(api.get(`/users/${id}`)),
  create: (b) => one(api.post('/users', b)), update: (id, b) => one(api.patch(`/users/${id}`, b)),
  setStatus: (id, status) => one(api.post(`/users/${id}/status`, { status })), resetPassword: (id, password) => one(api.post(`/users/${id}/reset-password`, { password })),
  requesters: (laboratoryId) => one(api.get('/users/requesters', { laboratoryId })),
};
export const inventoryApi = {
  list: (q) => list('/inventory', q), lookup: (q) => one(api.get('/inventory/lookup', q)), get: (id) => one(api.get(`/inventory/${id}`)),
  create: (b) => one(api.post('/inventory', b)), update: (id, b) => one(api.patch(`/inventory/${id}`, b)),
  archive: (id, reason) => one(api.post(`/inventory/${id}/archive`, { reason })), restore: (id) => one(api.post(`/inventory/${id}/restore`)),
  move: (id, b) => one(api.post(`/inventory/${id}/movements`, b)),
  transactions: (id, q) => list(`/inventory/${id}/transactions`, q), audit: (id) => one(api.get(`/inventory/${id}/audit`)),
};
export const assetsApi = {
  list: (q) => list('/assets', q), get: (id) => one(api.get(`/assets/${id}`)), register: (b) => one(api.post('/assets', b)),
  update: (id, b) => one(api.patch(`/assets/${id}`, b)), setState: (id, b) => one(api.post(`/assets/${id}/state`, b)),
};
export const borrowingApi = {
  list: (q) => list('/borrowing', q), get: (id) => one(api.get(`/borrowing/${id}`)), create: (b) => one(api.post('/borrowing', b)),
  approve: (id, reason) => one(api.post(`/borrowing/${id}/approve`, { reason })), reject: (id, reason) => one(api.post(`/borrowing/${id}/reject`, { reason })),
  cancel: (id, reason) => one(api.post(`/borrowing/${id}/cancel`, { reason })), releasePlan: (id) => one(api.get(`/borrowing/${id}/release-plan`)),
  release: (id, b) => one(api.post(`/borrowing/${id}/release`, b)), processReturn: (id, b) => one(api.post(`/borrowing/${id}/return`, b)),
  confirmReturn: (id) => one(api.post(`/borrowing/${id}/confirm-return`)),
};
export const maintenanceApi = {
  list: (q) => list('/maintenance', q), create: (b) => one(api.post('/maintenance', b)),
  update: (id, b) => one(api.patch(`/maintenance/${id}`, b)), complete: (id, b) => one(api.post(`/maintenance/${id}/complete`, b)),
};
export const damageApi = { list: (q) => list('/damage-loss', q), record: (b) => one(api.post('/damage-loss', b)) };
export const reportsApi = { get: (type, q) => one(api.get(`/reports/${type}`, q)), csvUrl: (type, q) => api.url(`/reports/${type}`, { ...q, format: 'csv' }) };
export const auditApi = { list: (q) => list('/audit', q), facets: () => one(api.get('/audit/facets')), csvUrl: (q) => api.url('/audit/export.csv', q) };
