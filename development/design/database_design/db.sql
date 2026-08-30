CREATE DATABASE IF NOT EXISTS laboratory_inventory;
USE laboratory_inventory;

-- =========================================================
-- 1. ROLE
-- =========================================================

CREATE TABLE `Role` (
    role_id INT AUTO_INCREMENT PRIMARY KEY,
    role_name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT
);

-- =========================================================
-- 2. USER
-- =========================================================

CREATE TABLE `User` (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    role_id INT NOT NULL,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    status VARCHAR(50),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,

    CONSTRAINT fk_user_role
        FOREIGN KEY (role_id)
        REFERENCES `Role`(role_id)
);

-- =========================================================
-- 3. LABORATORY
-- =========================================================

CREATE TABLE Laboratory (
    laboratory_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    type VARCHAR(100),
    location VARCHAR(255),
    description TEXT,
    status VARCHAR(50),
    created_at DATETIME NOT NULL
);

-- =========================================================
-- 4. USER_LABORATORY
-- Composite Primary Key: user_id + laboratory_id
-- =========================================================

CREATE TABLE User_Laboratory (
    user_id INT NOT NULL,
    laboratory_id INT NOT NULL,

    PRIMARY KEY (user_id, laboratory_id),

    CONSTRAINT fk_user_laboratory_user
        FOREIGN KEY (user_id)
        REFERENCES `User`(user_id),

    CONSTRAINT fk_user_laboratory_laboratory
        FOREIGN KEY (laboratory_id)
        REFERENCES Laboratory(laboratory_id)
);

-- =========================================================
-- 5. CATEGORY
-- =========================================================

CREATE TABLE Category (
    category_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL UNIQUE,
    description TEXT,
    status VARCHAR(50)
);

-- =========================================================
-- 6. INVENTORY_ITEM
-- =========================================================

CREATE TABLE Inventory_Item (
    item_id INT AUTO_INCREMENT PRIMARY KEY,
    item_name VARCHAR(200) NOT NULL,
    description TEXT,
    category_id INT NOT NULL,
    laboratory_id INT NOT NULL,
    item_type VARCHAR(50),
    unit_of_measurement VARCHAR(50),
    quantity DECIMAL(12,2),
    minimum_stock_level DECIMAL(12,2),
    `condition` VARCHAR(100),
    location VARCHAR(255),
    acquisition_date DATE,
    acquisition_source VARCHAR(255),
    remarks TEXT,
    status VARCHAR(50),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    archived_at DATETIME,

    CONSTRAINT fk_inventory_item_category
        FOREIGN KEY (category_id)
        REFERENCES Category(category_id),

    CONSTRAINT fk_inventory_item_laboratory
        FOREIGN KEY (laboratory_id)
        REFERENCES Laboratory(laboratory_id)
);

-- =========================================================
-- 7. ASSET
-- =========================================================

CREATE TABLE Asset (
    asset_id INT AUTO_INCREMENT PRIMARY KEY,
    item_id INT NOT NULL,
    laboratory_id INT NOT NULL,
    status VARCHAR(50),
    `condition` VARCHAR(100),
    remarks TEXT,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,

    CONSTRAINT fk_asset_item
        FOREIGN KEY (item_id)
        REFERENCES Inventory_Item(item_id),

    CONSTRAINT fk_asset_laboratory
        FOREIGN KEY (laboratory_id)
        REFERENCES Laboratory(laboratory_id)
);

-- =========================================================
-- 8. INVENTORY_TRANSACTION
-- =========================================================

CREATE TABLE Inventory_Transaction (
    transaction_id INT AUTO_INCREMENT PRIMARY KEY,
    item_id INT NOT NULL,
    user_id INT NOT NULL,
    transaction_type VARCHAR(50),
    quantity DECIMAL(12,2),
    transaction_date DATETIME NOT NULL,
    reason TEXT,
    source VARCHAR(255),
    remarks TEXT,

    CONSTRAINT fk_inventory_transaction_item
        FOREIGN KEY (item_id)
        REFERENCES Inventory_Item(item_id),

    CONSTRAINT fk_inventory_transaction_user
        FOREIGN KEY (user_id)
        REFERENCES `User`(user_id)
);

-- =========================================================
-- 9. BORROWING_REQUEST
-- =========================================================

CREATE TABLE Borrowing_Request (
    request_id INT AUTO_INCREMENT PRIMARY KEY,
    requester_id INT NOT NULL,
    laboratory_id INT NOT NULL,
    purpose TEXT,
    request_date DATETIME NOT NULL,
    expected_return_date DATETIME,
    status VARCHAR(50),
    approved_by INT,
    approval_date DATETIME,
    approval_reason TEXT,
    remarks TEXT,

    CONSTRAINT fk_borrowing_request_requester
        FOREIGN KEY (requester_id)
        REFERENCES `User`(user_id),

    CONSTRAINT fk_borrowing_request_laboratory
        FOREIGN KEY (laboratory_id)
        REFERENCES Laboratory(laboratory_id),

    CONSTRAINT fk_borrowing_request_approver
        FOREIGN KEY (approved_by)
        REFERENCES `User`(user_id)
);

-- =========================================================
-- 10. BORROWING_REQUEST_ITEM
-- =========================================================

CREATE TABLE Borrowing_Request_Item (
    request_item_id INT AUTO_INCREMENT PRIMARY KEY,
    request_id INT NOT NULL,
    item_id INT NOT NULL,
    requested_quantity DECIMAL(12,2),
    remarks TEXT,

    CONSTRAINT fk_borrowing_request_item_request
        FOREIGN KEY (request_id)
        REFERENCES Borrowing_Request(request_id),

    CONSTRAINT fk_borrowing_request_item_item
        FOREIGN KEY (item_id)
        REFERENCES Inventory_Item(item_id)
);

-- =========================================================
-- 11. RELEASE
-- =========================================================

CREATE TABLE `Release` (
    release_id INT AUTO_INCREMENT PRIMARY KEY,
    request_id INT NOT NULL,
    released_by INT NOT NULL,
    release_date DATETIME NOT NULL,
    remarks TEXT,

    CONSTRAINT fk_release_request
        FOREIGN KEY (request_id)
        REFERENCES Borrowing_Request(request_id),

    CONSTRAINT fk_release_user
        FOREIGN KEY (released_by)
        REFERENCES `User`(user_id)
);

-- =========================================================
-- 12. RELEASE_ITEM
-- =========================================================

CREATE TABLE Release_Item (
    release_item_id INT AUTO_INCREMENT PRIMARY KEY,
    release_id INT NOT NULL,
    item_id INT NOT NULL,
    asset_id INT,
    quantity_released DECIMAL(12,2),
    remarks TEXT,

    CONSTRAINT fk_release_item_release
        FOREIGN KEY (release_id)
        REFERENCES `Release`(release_id),

    CONSTRAINT fk_release_item_item
        FOREIGN KEY (item_id)
        REFERENCES Inventory_Item(item_id),

    CONSTRAINT fk_release_item_asset
        FOREIGN KEY (asset_id)
        REFERENCES Asset(asset_id)
);

-- =========================================================
-- 13. RETURN
-- =========================================================

CREATE TABLE `Return` (
    return_id INT AUTO_INCREMENT PRIMARY KEY,
    request_id INT NOT NULL,
    processed_by INT NOT NULL,
    return_date DATETIME NOT NULL,
    remarks TEXT,

    CONSTRAINT fk_return_request
        FOREIGN KEY (request_id)
        REFERENCES Borrowing_Request(request_id),

    CONSTRAINT fk_return_user
        FOREIGN KEY (processed_by)
        REFERENCES `User`(user_id)
);

-- =========================================================
-- 14. RETURN_ITEM
-- =========================================================

CREATE TABLE Return_Item (
    return_item_id INT AUTO_INCREMENT PRIMARY KEY,
    return_id INT NOT NULL,
    item_id INT NOT NULL,
    asset_id INT,
    quantity_returned DECIMAL(12,2),
    missing_quantity DECIMAL(12,2),
    damaged_quantity DECIMAL(12,2),
    `condition` VARCHAR(100),
    remarks TEXT,

    CONSTRAINT fk_return_item_return
        FOREIGN KEY (return_id)
        REFERENCES `Return`(return_id),

    CONSTRAINT fk_return_item_item
        FOREIGN KEY (item_id)
        REFERENCES Inventory_Item(item_id),

    CONSTRAINT fk_return_item_asset
        FOREIGN KEY (asset_id)
        REFERENCES Asset(asset_id)
);

-- =========================================================
-- 15. DAMAGE_LOSS_RECORD
-- =========================================================

CREATE TABLE Damage_Loss_Record (
    damage_loss_id INT AUTO_INCREMENT PRIMARY KEY,
    item_id INT,
    asset_id INT,
    record_type VARCHAR(50),
    date_recorded DATETIME NOT NULL,
    description TEXT,
    reported_by INT NOT NULL,
    current_condition VARCHAR(100),
    action_taken TEXT,
    remarks TEXT,

    CONSTRAINT fk_damage_loss_item
        FOREIGN KEY (item_id)
        REFERENCES Inventory_Item(item_id),

    CONSTRAINT fk_damage_loss_asset
        FOREIGN KEY (asset_id)
        REFERENCES Asset(asset_id),

    CONSTRAINT fk_damage_loss_user
        FOREIGN KEY (reported_by)
        REFERENCES `User`(user_id)
);

-- =========================================================
-- 16. MAINTENANCE_RECORD
-- =========================================================

CREATE TABLE Maintenance_Record (
    maintenance_id INT AUTO_INCREMENT PRIMARY KEY,
    asset_id INT NOT NULL,
    reported_issue TEXT,
    date_reported DATETIME NOT NULL,
    maintenance_action TEXT,
    responsible_person VARCHAR(200),
    date_completed DATETIME,
    maintenance_status VARCHAR(50),
    remarks TEXT,

    CONSTRAINT fk_maintenance_asset
        FOREIGN KEY (asset_id)
        REFERENCES Asset(asset_id)
);

-- =========================================================
-- 17. AUDIT_LOG
-- =========================================================

CREATE TABLE Audit_Log (
    audit_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    `timestamp` DATETIME NOT NULL,
    action VARCHAR(100),
    affected_entity VARCHAR(100),
    record_id INT,
    previous_value TEXT,
    new_value TEXT,
    reason TEXT,

    CONSTRAINT fk_audit_log_user
        FOREIGN KEY (user_id)
        REFERENCES `User`(user_id)
);
