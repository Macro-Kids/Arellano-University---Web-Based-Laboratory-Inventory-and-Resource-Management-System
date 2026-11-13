-- =============================================================================
-- AU·LAB — Laboratory Inventory & Resource Management
-- Migration 001: initial schema (SQLite)
--
-- Source of truth: development/design/database_design/db.sql (MySQL 8 design).
-- Table and column names are kept IDENTICAL to the design so the ERD and Data
-- Dictionary stay valid. Differences are ONLY:
--   * dialect (AUTOINCREMENT instead of AUTO_INCREMENT, CHECK constraints, etc.)
--   * the "EXTENSIONS" listed below, each marked with  -- [EXT]  in the schema.
--
-- EXTENSIONS (design decisions, documented in docs/DEVIATIONS.md):
--   [EXT-1] Session table               — server-side sessions (FR-001, SR-001)
--   [EXT-2] Asset.asset_tag/serial_number — human-readable unique Asset ID, e.g. MIC-003 (SRS 7.2, FR-011)
--   [EXT-3] Inventory_Item.asset_prefix  — prefix used to generate asset tags
--   [EXT-4] Inventory_Transaction.balance_after — running balance for traceability
--   [EXT-5] Borrowing_Request.return_confirmed_at — teacher "confirm return" (SRS 5.3)
--   [EXT-6] Damage_Loss_Record.quantity  — damaged/lost quantity for bulk items
--   [EXT-7] Audit_Log.laboratory_id      — lets coordinators see only their labs (BR-011)
--   [EXT-8] schema_migrations            — tracks applied migrations
--
-- Timestamps (DATETIME) are stored as ISO-8601 UTC strings: 2026-11-06T03:15:00.000Z
-- Dates (DATE) are stored as YYYY-MM-DD.
-- Signed quantities: Inventory_Transaction.quantity is SIGNED (stock-out is negative)
-- so that  SUM(quantity) == Inventory_Item.quantity  is always verifiable.
-- =============================================================================

-- 1. ROLE ---------------------------------------------------------------------
CREATE TABLE "Role" (
    role_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    role_name   TEXT NOT NULL UNIQUE,
    description TEXT
);

-- 2. USER ---------------------------------------------------------------------
CREATE TABLE "User" (
    user_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    role_id       INTEGER NOT NULL REFERENCES "Role"(role_id),
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    first_name    TEXT NOT NULL,
    last_name     TEXT NOT NULL,
    email         TEXT,
    status        TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
    created_at    DATETIME NOT NULL,
    updated_at    DATETIME NOT NULL
);
CREATE INDEX ix_user_role ON "User"(role_id);

-- 3. LABORATORY ---------------------------------------------------------------
CREATE TABLE Laboratory (
    laboratory_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    type          TEXT,
    location      TEXT,
    description   TEXT,
    status        TEXT NOT NULL DEFAULT 'Operational' CHECK (status IN ('Operational','Inactive')),
    created_at    DATETIME NOT NULL
);

-- 4. USER_LABORATORY ----------------------------------------------------------
CREATE TABLE User_Laboratory (
    user_id       INTEGER NOT NULL REFERENCES "User"(user_id) ON DELETE CASCADE,
    laboratory_id INTEGER NOT NULL REFERENCES Laboratory(laboratory_id),
    PRIMARY KEY (user_id, laboratory_id)
);
CREATE INDEX ix_user_laboratory_lab ON User_Laboratory(laboratory_id);

-- 5. CATEGORY -----------------------------------------------------------------
CREATE TABLE Category (
    category_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive'))
);

-- 6. INVENTORY_ITEM -----------------------------------------------------------
-- item_type: 'Equipment'  = every unit is an individually tracked Asset;
--                           quantity is DERIVED from the asset register.
--            'Consumable' = tracked by quantity only (consumables and bulk supplies).
CREATE TABLE Inventory_Item (
    item_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    item_name           TEXT NOT NULL,
    description         TEXT,
    category_id         INTEGER NOT NULL REFERENCES Category(category_id),
    laboratory_id       INTEGER NOT NULL REFERENCES Laboratory(laboratory_id),
    item_type           TEXT NOT NULL CHECK (item_type IN ('Consumable','Equipment')),
    unit_of_measurement TEXT NOT NULL DEFAULT 'unit',
    quantity            DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),          -- BR-003
    minimum_stock_level DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (minimum_stock_level >= 0),
    "condition"         TEXT CHECK ("condition" IN ('Excellent','Good','Fair','Damaged','Non-functional')),
    location            TEXT,
    acquisition_date    DATE,
    acquisition_source  TEXT,
    remarks             TEXT,
    status              TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Archived')),
    created_at          DATETIME NOT NULL,
    updated_at          DATETIME NOT NULL,
    archived_at         DATETIME,
    asset_prefix        TEXT                                                              -- [EXT-3]
);
CREATE INDEX ix_item_lab_status ON Inventory_Item(laboratory_id, status);
CREATE INDEX ix_item_category   ON Inventory_Item(category_id);
-- Prevent duplicate active names inside one laboratory.
CREATE UNIQUE INDEX ux_item_lab_name ON Inventory_Item(laboratory_id, lower(item_name)) WHERE status = 'Active';

-- 7. ASSET --------------------------------------------------------------------
CREATE TABLE Asset (
    asset_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id       INTEGER NOT NULL REFERENCES Inventory_Item(item_id),
    laboratory_id INTEGER NOT NULL REFERENCES Laboratory(laboratory_id),
    asset_tag     TEXT NOT NULL UNIQUE COLLATE NOCASE,                                   -- [EXT-2] BR-002 / FR-011
    serial_number TEXT,                                                                  -- [EXT-2]
    status        TEXT NOT NULL DEFAULT 'Available' CHECK (status IN
                  ('Available','In Use','Borrowed','Under Inspection','Under Maintenance','Damaged','Lost','Retired')), -- FR-012
    "condition"   TEXT NOT NULL DEFAULT 'Good' CHECK ("condition" IN
                  ('Excellent','Good','Fair','Damaged','Non-functional')),               -- FR-013 (separate from status)
    remarks       TEXT,
    created_at    DATETIME NOT NULL,
    updated_at    DATETIME NOT NULL
);
CREATE INDEX ix_asset_item_status ON Asset(item_id, status);
CREATE INDEX ix_asset_lab         ON Asset(laboratory_id);

-- 8. INVENTORY_TRANSACTION ----------------------------------------------------
CREATE TABLE Inventory_Transaction (
    transaction_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id          INTEGER NOT NULL REFERENCES Inventory_Item(item_id),
    user_id          INTEGER NOT NULL REFERENCES "User"(user_id),
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('Stock-in','Stock-out','Adjustment','Transfer')),
    quantity         DECIMAL(12,2) NOT NULL,                  -- SIGNED (see header)
    transaction_date DATETIME NOT NULL,
    reason           TEXT NOT NULL,
    source           TEXT,
    remarks          TEXT,
    balance_after    DECIMAL(12,2)                            -- [EXT-4]
);
CREATE INDEX ix_trx_item_date ON Inventory_Transaction(item_id, transaction_date);
CREATE INDEX ix_trx_date      ON Inventory_Transaction(transaction_date);

-- 9. BORROWING_REQUEST --------------------------------------------------------
CREATE TABLE Borrowing_Request (
    request_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id         INTEGER NOT NULL REFERENCES "User"(user_id),
    laboratory_id        INTEGER NOT NULL REFERENCES Laboratory(laboratory_id),
    purpose              TEXT NOT NULL,
    request_date         DATETIME NOT NULL,
    expected_return_date DATE,
    status               TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN
                         ('Pending','Approved','Rejected','Released','Returned','Overdue','Cancelled')), -- FR-015
    approved_by          INTEGER REFERENCES "User"(user_id),
    approval_date        DATETIME,
    approval_reason      TEXT,
    remarks              TEXT,
    return_confirmed_at  DATETIME                                                        -- [EXT-5]
);
CREATE INDEX ix_req_requester  ON Borrowing_Request(requester_id);
CREATE INDEX ix_req_lab_status ON Borrowing_Request(laboratory_id, status);
CREATE INDEX ix_req_status_due ON Borrowing_Request(status, expected_return_date);

-- 10. BORROWING_REQUEST_ITEM --------------------------------------------------
CREATE TABLE Borrowing_Request_Item (
    request_item_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id         INTEGER NOT NULL REFERENCES Borrowing_Request(request_id),
    item_id            INTEGER NOT NULL REFERENCES Inventory_Item(item_id),
    requested_quantity DECIMAL(12,2) NOT NULL CHECK (requested_quantity > 0),
    remarks            TEXT,
    UNIQUE (request_id, item_id)
);

-- 11. RELEASE -----------------------------------------------------------------
CREATE TABLE "Release" (
    release_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id   INTEGER NOT NULL REFERENCES Borrowing_Request(request_id),
    released_by  INTEGER NOT NULL REFERENCES "User"(user_id),
    release_date DATETIME NOT NULL,
    remarks      TEXT
);
CREATE INDEX ix_release_request ON "Release"(request_id);

-- 12. RELEASE_ITEM ------------------------------------------------------------
CREATE TABLE Release_Item (
    release_item_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    release_id        INTEGER NOT NULL REFERENCES "Release"(release_id),
    item_id           INTEGER NOT NULL REFERENCES Inventory_Item(item_id),
    asset_id          INTEGER REFERENCES Asset(asset_id),
    quantity_released DECIMAL(12,2) NOT NULL CHECK (quantity_released > 0),
    remarks           TEXT
);
CREATE INDEX ix_release_item_release ON Release_Item(release_id);
CREATE INDEX ix_release_item_asset   ON Release_Item(asset_id);

-- 13. RETURN ------------------------------------------------------------------
CREATE TABLE "Return" (
    return_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id   INTEGER NOT NULL REFERENCES Borrowing_Request(request_id),
    processed_by INTEGER NOT NULL REFERENCES "User"(user_id),
    return_date  DATETIME NOT NULL,
    remarks      TEXT
);
CREATE INDEX ix_return_request ON "Return"(request_id);

-- 14. RETURN_ITEM -------------------------------------------------------------
CREATE TABLE Return_Item (
    return_item_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    return_id         INTEGER NOT NULL REFERENCES "Return"(return_id),
    item_id           INTEGER NOT NULL REFERENCES Inventory_Item(item_id),
    asset_id          INTEGER REFERENCES Asset(asset_id),
    quantity_returned DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (quantity_returned >= 0),
    missing_quantity  DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (missing_quantity >= 0),
    damaged_quantity  DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (damaged_quantity >= 0),
    "condition"       TEXT,
    remarks           TEXT
);
CREATE INDEX ix_return_item_return ON Return_Item(return_id);
CREATE INDEX ix_return_item_asset  ON Return_Item(asset_id);

-- 15. DAMAGE_LOSS_RECORD ------------------------------------------------------
CREATE TABLE Damage_Loss_Record (
    damage_loss_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id           INTEGER REFERENCES Inventory_Item(item_id),
    asset_id          INTEGER REFERENCES Asset(asset_id),
    record_type       TEXT NOT NULL CHECK (record_type IN ('Damage','Loss')),
    date_recorded     DATETIME NOT NULL,
    description       TEXT NOT NULL,
    reported_by       INTEGER NOT NULL REFERENCES "User"(user_id),
    current_condition TEXT,
    action_taken      TEXT,
    remarks           TEXT,
    quantity          DECIMAL(12,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),             -- [EXT-6]
    CHECK (item_id IS NOT NULL OR asset_id IS NOT NULL)
);
CREATE INDEX ix_dlr_item  ON Damage_Loss_Record(item_id);
CREATE INDEX ix_dlr_asset ON Damage_Loss_Record(asset_id);

-- 16. MAINTENANCE_RECORD ------------------------------------------------------
CREATE TABLE Maintenance_Record (
    maintenance_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id           INTEGER NOT NULL REFERENCES Asset(asset_id),
    reported_issue     TEXT NOT NULL,
    date_reported      DATETIME NOT NULL,
    maintenance_action TEXT,
    responsible_person TEXT,
    date_completed     DATETIME,
    maintenance_status TEXT NOT NULL DEFAULT 'Open' CHECK (maintenance_status IN ('Open','In Progress','Completed')),
    remarks            TEXT
);
CREATE INDEX ix_maint_asset  ON Maintenance_Record(asset_id);
CREATE INDEX ix_maint_status ON Maintenance_Record(maintenance_status);

-- 17. AUDIT_LOG ---------------------------------------------------------------
CREATE TABLE Audit_Log (
    audit_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES "User"(user_id),
    "timestamp"     DATETIME NOT NULL,
    action          TEXT NOT NULL,
    affected_entity TEXT NOT NULL,
    record_id       INTEGER,
    previous_value  TEXT,
    new_value       TEXT,
    reason          TEXT,
    laboratory_id   INTEGER REFERENCES Laboratory(laboratory_id)                         -- [EXT-7]
);
CREATE INDEX ix_audit_time   ON Audit_Log("timestamp");
CREATE INDEX ix_audit_entity ON Audit_Log(affected_entity, record_id);
CREATE INDEX ix_audit_user   ON Audit_Log(user_id);
CREATE INDEX ix_audit_lab    ON Audit_Log(laboratory_id);

-- [EXT-1] SESSION -------------------------------------------------------------
-- session_id stores the SHA-256 hash of the cookie token, never the token itself.
CREATE TABLE Session (
    session_id   TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES "User"(user_id) ON DELETE CASCADE,
    csrf_token   TEXT NOT NULL,
    created_at   DATETIME NOT NULL,
    expires_at   DATETIME NOT NULL,
    last_seen_at DATETIME NOT NULL,
    ip_address   TEXT,
    user_agent   TEXT
);
CREATE INDEX ix_session_user    ON Session(user_id);
CREATE INDEX ix_session_expires ON Session(expires_at);

-- =============================================================================
-- IMMUTABILITY GUARDS  (BR-008 "completed transactions shall not be silently
-- deleted", FR-032 "audit records shall not be editable by ordinary users").
-- Enforced by the database itself, so no application bug can bypass them.
-- =============================================================================
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON Audit_Log
BEGIN SELECT RAISE(ABORT, 'Audit_Log records are immutable'); END;
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON Audit_Log
BEGIN SELECT RAISE(ABORT, 'Audit_Log records cannot be deleted'); END;

CREATE TRIGGER trg_trx_no_update BEFORE UPDATE ON Inventory_Transaction
BEGIN SELECT RAISE(ABORT, 'Inventory_Transaction records are immutable'); END;
CREATE TRIGGER trg_trx_no_delete BEFORE DELETE ON Inventory_Transaction
BEGIN SELECT RAISE(ABORT, 'Inventory_Transaction records cannot be deleted'); END;

CREATE TRIGGER trg_release_no_delete BEFORE DELETE ON "Release"
BEGIN SELECT RAISE(ABORT, 'Release records cannot be deleted'); END;
CREATE TRIGGER trg_release_item_no_delete BEFORE DELETE ON Release_Item
BEGIN SELECT RAISE(ABORT, 'Release_Item records cannot be deleted'); END;
CREATE TRIGGER trg_return_no_delete BEFORE DELETE ON "Return"
BEGIN SELECT RAISE(ABORT, 'Return records cannot be deleted'); END;
CREATE TRIGGER trg_return_item_no_delete BEFORE DELETE ON Return_Item
BEGIN SELECT RAISE(ABORT, 'Return_Item records cannot be deleted'); END;
CREATE TRIGGER trg_dlr_no_delete BEFORE DELETE ON Damage_Loss_Record
BEGIN SELECT RAISE(ABORT, 'Damage_Loss_Record records cannot be deleted'); END;
CREATE TRIGGER trg_request_no_delete BEFORE DELETE ON Borrowing_Request
BEGIN SELECT RAISE(ABORT, 'Borrowing_Request records cannot be deleted'); END;
CREATE TRIGGER trg_request_item_no_delete BEFORE DELETE ON Borrowing_Request_Item
BEGIN SELECT RAISE(ABORT, 'Borrowing_Request_Item records cannot be deleted'); END;
CREATE TRIGGER trg_maint_no_delete BEFORE DELETE ON Maintenance_Record
BEGIN SELECT RAISE(ABORT, 'Maintenance_Record records cannot be deleted'); END;

-- Reference data (roles are fixed by SRS section 5).
INSERT INTO "Role" (role_name, description) VALUES
 ('System Administrator',   'System-wide administration: users, laboratories, categories, reports, audit logs and configuration.'),
 ('Laboratory Coordinator', 'Manages inventory, equipment, borrowing, maintenance, adjustments and reports for assigned laboratories.'),
 ('Laboratory Staff',       'Day-to-day operations: release, return processing, damage/loss and maintenance recording.'),
 ('Teacher',                'Checks availability, submits and tracks own borrowing requests, confirms returns.'),
 ('System',                 'Internal service account used to attribute automatic actions (e.g. overdue detection). Cannot sign in.');
