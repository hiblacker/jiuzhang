-- Synthetic source fixture for verifying registered-SQL ingestion end to end.
-- Never pointed at a real business database. Its whole purpose is to exercise the
-- awkward parts: non-ASCII identifiers, DECIMAL(20,2) precision, DATETIME(3) millis,
-- NULLs, a leading-zero string, and a read-only account.
SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS erp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE erp;

CREATE TABLE biz_order (
  id BIGINT NOT NULL PRIMARY KEY,
  `订单编号` VARCHAR(32) NOT NULL,
  `金额` DECIMAL(20,2) NOT NULL,
  `更新时间` DATETIME(3) NOT NULL,
  `备注` VARCHAR(100) NULL
) ENGINE = InnoDB;

INSERT INTO biz_order (id, `订单编号`, `金额`, `更新时间`, `备注`) VALUES
  (1, 'NO-0001', 12345678901234567.89, '2026-09-17 09:58:11.123', NULL),
  (2, 'NO-0002', -0.01,                 '2026-09-17 10:00:00.000', '含中文备注'),
  (3, 'NO-0003', 999999999999999999.99, '2026-09-16 23:59:59.999', '007');

CREATE TABLE customer (
  id BIGINT NOT NULL PRIMARY KEY,
  name VARCHAR(64) NOT NULL
) ENGINE = InnoDB;

INSERT INTO customer (id, name) VALUES (1, '东区'), (2, '西区');

-- The platform requires proof that ingestion cannot write, so the fixture ships a
-- deliberately read-only account and a second one that is not, to test both outcomes.
CREATE USER IF NOT EXISTS 'erp_ro'@'%' IDENTIFIED BY '__READ_ONLY_PASSWORD__';
GRANT SELECT ON erp.* TO 'erp_ro'@'%';
FLUSH PRIVILEGES;
