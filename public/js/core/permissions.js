// permissions.js — permission NAMES used by the UI to decide what to show.
// (The server enforces them for real; keep in sync with server/modules/auth/permissions.js.)
export const P = Object.freeze({
  USERS_MANAGE: 'users.manage', LABS_MANAGE: 'laboratories.manage', CATEGORIES_MANAGE: 'categories.manage',
  INVENTORY_VIEW: 'inventory.view', INVENTORY_CREATE: 'inventory.create', INVENTORY_UPDATE: 'inventory.update', INVENTORY_ARCHIVE: 'inventory.archive',
  STOCK_MOVE: 'stock.move', STOCK_ADJUST: 'stock.adjust',
  ASSETS_VIEW: 'assets.view', ASSETS_REGISTER: 'assets.register', ASSETS_UPDATE: 'assets.update',
  BORROW_CREATE: 'borrowing.create', BORROW_CREATE_FOR_OTHERS: 'borrowing.create_for_others', BORROW_VIEW_ALL: 'borrowing.view_all',
  BORROW_APPROVE: 'borrowing.approve', BORROW_RELEASE: 'borrowing.release', BORROW_RETURN: 'borrowing.return', BORROW_CANCEL_ANY: 'borrowing.cancel_any', BORROW_CONFIRM_RETURN: 'borrowing.confirm_return',
  DAMAGE_RECORD: 'damage.record', MAINTENANCE_VIEW: 'maintenance.view', MAINTENANCE_MANAGE: 'maintenance.manage',
  REPORTS_VIEW: 'reports.view', AUDIT_VIEW: 'audit.view', SYSTEM_MANAGE: 'system.manage',
});
