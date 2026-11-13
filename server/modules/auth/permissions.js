// -----------------------------------------------------------------------------
// permissions.js — THE role/permission matrix (SRS section 5, FR-003, SR-002).
// Server-side checks use these names via requirePermission(); the UI receives
// the list in /api/auth/me ONLY to decide what to show — never to authorise.
// To change who can do what, edit this file and nothing else.
// -----------------------------------------------------------------------------
export const P = Object.freeze({
  USERS_MANAGE: 'users.manage',
  LABS_MANAGE: 'laboratories.manage',
  CATEGORIES_MANAGE: 'categories.manage',

  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_VIEW_DETAILS: 'inventory.view_details', // acquisition source, remarks
  INVENTORY_CREATE: 'inventory.create',
  INVENTORY_UPDATE: 'inventory.update',
  INVENTORY_ARCHIVE: 'inventory.archive',
  STOCK_MOVE: 'stock.move',     // stock-in / stock-out / transfer
  STOCK_ADJUST: 'stock.adjust', // controlled adjustment (FR-010)

  ASSETS_VIEW: 'assets.view',
  ASSETS_REGISTER: 'assets.register',
  ASSETS_UPDATE: 'assets.update', // status / condition

  BORROW_CREATE: 'borrowing.create',
  BORROW_CREATE_FOR_OTHERS: 'borrowing.create_for_others',
  BORROW_VIEW_ALL: 'borrowing.view_all', // all requests in scope (otherwise: own only — BR-012)
  BORROW_APPROVE: 'borrowing.approve',
  BORROW_RELEASE: 'borrowing.release',
  BORROW_RETURN: 'borrowing.return',
  BORROW_CANCEL_ANY: 'borrowing.cancel_any',
  BORROW_CONFIRM_RETURN: 'borrowing.confirm_return',

  DAMAGE_RECORD: 'damage.record',
  MAINTENANCE_VIEW: 'maintenance.view',
  MAINTENANCE_MANAGE: 'maintenance.manage',

  REPORTS_VIEW: 'reports.view',
  AUDIT_VIEW: 'audit.view',
  SYSTEM_MANAGE: 'system.manage', // backups, diagnostics, integrity check
});

const STAFF = [
  P.INVENTORY_VIEW, P.INVENTORY_VIEW_DETAILS, P.STOCK_MOVE,
  P.ASSETS_VIEW, P.ASSETS_UPDATE,
  P.BORROW_CREATE, P.BORROW_CREATE_FOR_OTHERS, P.BORROW_VIEW_ALL, P.BORROW_APPROVE, P.BORROW_RELEASE, P.BORROW_RETURN, P.BORROW_CANCEL_ANY,
  P.DAMAGE_RECORD, P.MAINTENANCE_VIEW, P.MAINTENANCE_MANAGE,
];

export const ROLE_PERMISSIONS = Object.freeze({
  // 5.1 — administers the system; reads inventory/reports/audit system-wide, does not move stock.
  'System Administrator': [
    P.USERS_MANAGE, P.LABS_MANAGE, P.CATEGORIES_MANAGE,
    P.INVENTORY_VIEW, P.INVENTORY_VIEW_DETAILS, P.ASSETS_VIEW, P.BORROW_VIEW_ALL, P.MAINTENANCE_VIEW,
    P.REPORTS_VIEW, P.AUDIT_VIEW, P.SYSTEM_MANAGE,
  ],
  // 5.2 — everything staff can do, plus managing inventory, adjustments, reports, audit (own labs).
  'Laboratory Coordinator': [
    ...STAFF,
    P.INVENTORY_CREATE, P.INVENTORY_UPDATE, P.INVENTORY_ARCHIVE, P.STOCK_ADJUST, P.ASSETS_REGISTER,
    P.REPORTS_VIEW, P.AUDIT_VIEW,
  ],
  // 5.5 — day-to-day operations.
  'Laboratory Staff': STAFF,
  // 5.3 — read availability, manage OWN requests, cannot modify quantities.
  'Teacher': [P.INVENTORY_VIEW, P.BORROW_CREATE, P.BORROW_CONFIRM_RETURN],
  // internal account — can never sign in.
  'System': [],
});

export const permissionsFor = (roleName) => new Set(ROLE_PERMISSIONS[roleName] || []);
/** Roles with system-wide scope (BR-011: everyone else is limited to assigned laboratories). */
export const isGlobalRole = (roleName) => roleName === 'System Administrator';
export const ASSIGNABLE_ROLES = ['System Administrator', 'Laboratory Coordinator', 'Laboratory Staff', 'Teacher'];
