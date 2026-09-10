-- Synthetic business configuration: these are NOT the real DevOps status mappings.
INSERT INTO model.status_map VALUES
 ('devops','todo','open'),('devops','done','done'),('devops','reopened','open'),
 ('helpdesk','new','open'),('helpdesk','resolved','done');
INSERT INTO model.period VALUES
 ('2026-01-30','day','2026-01-30 00:00:00+08','2026-01-31 00:00:00+08'),
 ('2026-01-31','day','2026-01-31 00:00:00+08','2026-02-01 00:00:00+08'),
 ('2026-02-01','day','2026-02-01 00:00:00+08','2026-02-02 00:00:00+08'),
 ('2026-01','month','2026-01-01 00:00:00+08','2026-02-01 00:00:00+08');
INSERT INTO raw.object VALUES
 ('devops','A','2026-01-30 00:00+08',true),
 ('devops','B','2026-01-30 00:00+08',true),
 ('devops','C','2026-01-30 00:00+08',true),
 ('devops','D','2026-01-30 00:00+08',true),
 ('devops','E','2026-01-30 00:00+08',false),
 ('devops','F','2026-01-30 00:00+08',true),
 ('devops','G','2026-01-30 00:00+08',true),
 ('helpdesk','H','2026-01-30 00:00+08',true);
INSERT INTO raw.team_history VALUES
 ('devops','A','alpha','2026-01-30 00:00+08','2026-02-01 00:00+08'),
 ('devops','A','beta','2026-02-01 00:00+08',NULL),
 ('devops','B','alpha','2026-01-30 00:00+08',NULL),
 ('devops','C','alpha','2026-01-30 00:00+08',NULL),
 ('devops','D','uncertain','2026-01-30 00:00+08',NULL),
 ('devops','E','uncertain','2026-01-30 00:00+08',NULL),
 ('devops','F','alpha','2026-01-30 00:00+08',NULL),
 ('helpdesk','H','service','2026-01-30 00:00+08',NULL);
INSERT INTO warehouse.report_scope VALUES
 ('p0_report_a','devops','alpha'),('p0_report_b','helpdesk','service');
-- Explicit synthetic transition events, not guesses from single-value business logs.
SELECT raw.ingest(v.domain,'synthetic-batch-1','2026-02-01 23:00+08',v.payload::jsonb)
FROM (VALUES
 ('devops','{"id":"a0","object":"A","at":"2026-01-30T00:00:00+08:00","updated":"2026-01-30T00:00:00+08:00","status":"todo"}'),
 ('devops','{"id":"a1","object":"A","at":"2026-01-30T12:00:00+08:00","updated":"2026-01-30T12:00:00+08:00","status":"done","started":"2026-01-30T10:00:00+08:00"}'),
 ('devops','{"id":"a2","object":"A","at":"2026-01-31T09:00:00+08:00","updated":"2026-01-31T09:00:00+08:00","status":"reopened"}'),
 ('devops','{"id":"a3","object":"A","at":"2026-01-31T13:00:00+08:00","updated":"2026-01-31T13:00:00+08:00","status":"done","started":"2026-01-31T09:00:00+08:00"}'),
 ('devops','{"id":"a4","object":"A","at":"2026-02-01T00:00:00+08:00","updated":"2026-02-01T00:00:00+08:00","status":"reopened"}'),
 ('devops','{"id":"a5","object":"A","at":"2026-02-01T02:00:00+08:00","updated":"2026-02-01T02:00:00+08:00","status":"done","started":"2026-02-01T00:00:00+08:00"}'),
 ('devops','{"id":"b0","object":"B","at":"2026-01-30T00:00:00+08:00","updated":"2026-01-30T00:00:00+08:00","status":"todo"}'),
 ('devops','{"id":"b1","object":"B","at":"2026-01-31T23:59:59.999999+08:00","updated":"2026-01-31T23:59:59.999999+08:00","status":"done"}'),
 ('devops','{"id":"c0","object":"C","at":"2026-01-30T00:00:00+08:00","updated":"2026-01-30T00:00:00+08:00","status":"todo"}'),
 ('devops','{"id":"c1","object":"C","at":"2026-01-31T14:00:00+08:00","updated":"2026-01-31T14:00:00+08:00","status":"done","started":"2026-01-31T15:00:00+08:00"}'),
 ('devops','{"id":"d0","object":"D","at":"2026-01-30T00:00:00+08:00","updated":"2026-01-30T00:00:00+08:00","status":"unmapped-label"}'),
 ('devops','{"id":"f0","object":"F","at":"2026-01-30T00:00:00+08:00","updated":"2026-01-30T00:00:00+08:00","status":"todo"}'),
 ('devops','{"id":"g0","object":"G","at":"2026-01-30T00:00:00+08:00","updated":"2026-01-30T00:00:00+08:00","status":"todo"}'),
 ('helpdesk','{"id":"h0","object":"H","at":"2026-01-30T00:00:00+08:00","updated":"2026-01-30T00:00:00+08:00","status":"new"}'),
 ('helpdesk','{"id":"h1","object":"H","at":"2026-01-31T12:00:00+08:00","updated":"2026-01-31T12:00:00+08:00","status":"resolved","started":"2026-01-31T09:00:00+08:00"}')
) v(domain,payload);
