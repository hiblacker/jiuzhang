# P0-a spike: SeaTunnel as the SQL extraction execution layer

Answers the five open questions of [doc 45 §1](../../docs/45-sql-ingestion-with-seatunnel.md)
before any product code is written. Local synthetic fixtures only; the stack is
isolated (`jiuzhang-st-spike`) and does not touch the product deployment.

## Run

```bash
node poc/seatunnel-sql/run.mjs      # ~3 minutes; brings the stack up, verifies, tears nothing down
docker compose -p jiuzhang-st-spike -f poc/seatunnel-sql/compose.yaml down -v   # cleanup (works without env)
# `up` must go through run.mjs: it generates the throwaway credentials under work/.
```

Requires the two pinned images locally (no network): `apache/seatunnel:2.3.13`,
`mysql:8.0.43`. Evidence lands in `results.json`; raw output files under `out/`
(git-ignored) are left for inspection.

## Answers (2026-09-17, SeaTunnel 2.3.13, MySQL 8.0.43)

| Question | Answer | Evidence |
|---|---|---|
| Can the file sink emit JSONL directly? | **Yes.** One JSON object per line, part file `T_<jobId>_<hash>_0_1_0.json`; `isJsonl: true`, `isJsonArray: false` | `results.fileSink` |
| Is `DECIMAL(20,2)` precision preserved? | **In the file text, yes** (`12345678901234567.89`, `999999999999999999.99`, `-0.01` appear verbatim) — but the sink writes them as **unquoted JSON numbers**, so any float-based reader (JS `JSON.parse`, Python `json`) silently rounds them. The contract-aligned variant `CAST(col AS CHAR)` writes them as **strings** with identical digits | `results.typeFidelity.decimalExactInFileText`, `results.charCastVariant` |
| Datetime representation? | Without `CAST`: ISO-8601 in **UTC with no offset marker** (`2026-09-17T01:58:11.123`) and millis dropped when zero. With `CAST(... AS CHAR)`: **source-local wall clock** `2026-09-17 09:58:11.123` | `results.typeFidelity.datetime`, `results.charCastVariant.updatedAtString` |
| Is there a cancel API? | **Yes.** `POST /hazelcast/rest/maps/stop-job` with `{"jobId":…}` → 200, status becomes `CANCELED`, and **no partial output files remain** | `results.cancel` |
| Concurrency and memory? | Two jobs ran **simultaneously** (`runningJobs: 2`, `pendingJobs: 0`) at 486–530 MiB of a 2 GiB / 1 CPU container | `results.concurrency` |

Also verified: the read-only account is refused writes (`ERROR 1142` on `CREATE TABLE`)
while `SELECT` works — the connection test the platform will require.

## Findings that change the design

1. **Precision-sensitive columns must be cast to text.** The existing RAW contract
   already stores MySQL scalars as text (`scalarEncoding: "mysql-char-v2"`), so SQL
   mode should generate `CAST(col AS CHAR)` for `DECIMAL`/`DATETIME`/`TIMESTAMP`
   columns (see `jobs/orders-char-cast.json`). This keeps the JSONL contract, needs
   no reader change, and removes the ambiguous UTC-without-offset timestamp form.
2. **The connection charset must be an explicit datasource field.** The first run
   failed with `Unknown column '订单编号'` because the fixture's init script did not
   set `SET NAMES utf8mb4`; the column was stored double-encoded. The product's own
   MySQL path already pins `default-character-set=utf8mb4`
   (`tools/mysql-discover.mjs`, used by `tools/lake-ingest.mjs`), so this was a
   fixture defect — but every datasource/SQL definition must carry a charset.
3. **Cancel is safe to expose in the UI**: a canceled job leaves no partial files,
   so "取消" cannot publish half a batch.
4. **`stop-job` exists but no `stop-jobs` semantics were exercised**; batch cancel of
   many jobs should be a loop with per-job confirmation.

## Boundaries of this spike

- Concurrency was measured with `SLEEP()`-bound jobs (low CPU); a CPU-bound test is
  still needed before quoting a job-per-slot number.
- Three rows in the source table: no volume, throughput or backpressure evidence.
- No real source system, no TLS, no SSH tunnel, no CDC, no failure injection, no
  restart/recovery, no SeaTunnel cluster mode (single Zeta node, local engine).
- Only MySQL was exercised; the other dialects in doc 46 remain unverified.
- The engine container publishes the REST port on loopback **for this spike only**;
  the product design submits from the worker inside the compose network.
