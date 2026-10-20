SET NAMES utf8mb4;
CREATE TABLE IF NOT EXISTS orders (
    id bigint unsigned PRIMARY KEY,
    customer varchar(100) NOT NULL,
    amount decimal(20,4) NOT NULL,
    phone varchar(30),
    city varchar(60),
    updated_at datetime(6) NOT NULL
) ENGINE=InnoDB;
ALTER TABLE orders
    MODIFY COLUMN id bigint unsigned NOT NULL COMMENT '订单主键',
    MODIFY COLUMN customer varchar(100) NOT NULL COMMENT '合成客户标识',
    MODIFY COLUMN amount decimal(20,4) NOT NULL COMMENT '订单金额',
    MODIFY COLUMN phone varchar(30) COMMENT '合成手机号',
    MODIFY COLUMN city varchar(60) COMMENT '收货城市',
    MODIFY COLUMN updated_at datetime(6) NOT NULL COMMENT '订单更新时间';
INSERT IGNORE INTO orders VALUES
(9007199254740993,'synthetic alice',12345.6700,'13800000001','杭州','2026-10-19 00:00:00.123456'),
(9007199254740994,'synthetic bob',0.0000,'13800000002','上海','2026-10-19 00:00:01.000000'),
(9007199254740995,'synthetic carol',42.5000,NULL,'北京','2026-10-19 00:00:02.000000');
