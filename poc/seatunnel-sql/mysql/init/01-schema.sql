-- Spike fixture: synthetic only. Creates a Chinese-named, precision-sensitive table
-- plus a slow table used for the cancel test. Passwords are throwaway spike values.
SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS spike CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE spike;

CREATE TABLE spike_orders (
  id BIGINT NOT NULL PRIMARY KEY,
  `订单编号` VARCHAR(32) NOT NULL,
  `金额` DECIMAL(20,2) NOT NULL,
  `更新时间` DATETIME(3) NOT NULL,
  `备注` VARCHAR(100) NULL
) ENGINE = InnoDB;

INSERT INTO spike_orders (id, `订单编号`, `金额`, `更新时间`, `备注`) VALUES
  (1, 'NO-0001', 12345678901234567.89, '2026-09-17 09:58:11.123', NULL),
  (2, 'NO-0002', -0.01,                 '2026-09-17 10:00:00.000', '含中文备注'),
  (3, 'NO-0003', 999999999999999999.99, '2026-09-16 23:59:59.999', '007');

CREATE TABLE spike_slow (
  id BIGINT NOT NULL PRIMARY KEY,
  note VARCHAR(32) NOT NULL
) ENGINE = InnoDB;

INSERT INTO spike_slow (id, note)
WITH RECURSIVE seq (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 400)
SELECT n, CONCAT('row-', n) FROM seq;

-- Read-only account: the platform requires proof that ingestion cannot write.
-- Password is substituted at run time by run.mjs into a git-ignored copy.
CREATE USER IF NOT EXISTS 'spike_ro'@'%' IDENTIFIED BY '__APP_PASSWORD__';
GRANT SELECT ON spike.* TO 'spike_ro'@'%';
FLUSH PRIVILEGES;
