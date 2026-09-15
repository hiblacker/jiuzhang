# Component PoC (POC-01) install lock and smoke

This directory records the approved install lock for the component PoC: [design and candidate matrix](../../docs/18-component-poc-matrix.md), [compatibility evidence](../../docs/research/component-compat-2026-09-11.json), [lock file](dependencies.lock.json).

## What was done (2026-09-11)

1. User approved the matrix (lock-then-install) and the nine-metric baseline — see [docs/18 approval record](../../docs/18-component-poc-matrix.md).
2. Network: Docker Hub was unreachable from the host; the user enabled a proxy and pulls then succeeded through Docker Desktop's internal proxy. Recorded in the lock provenance.
3. Images pulled once and version-pinned (see lock): `python:3.12-slim`, `apache/seatunnel:2.3.13`, `apache/dolphinscheduler-standalone-server:3.4.3`. PostgreSQL 16.15 and `mysql:8.0.43` reuse the previously locked cache — no new pulls. Runtime commands use these version tags, never image IDs or digests.
4. dbt transitive dependency lock: 59 packages installed in the pinned Python image, each with license metadata recorded in the lock JSON (raw capture stayed in the ignored `work/` directory). Two review flags: `psycopg2-binary` (LGPL with linking exception — acceptable for internal use/PoC, NOTICE due at delivery) and `text-unidecode` (Artistic/GPL dual — Artistic path).
5. Smoke results:
   - dbt: `dbt --version` reports Core 1.12.4 and postgres plugin 1.11.0 in the pinned image — the candidate pairing runs.
   - SeaTunnel: a FakeSource→Console batch job ran with `-e local` and ended with state `FINISHED` on engine 2.3.13.
   - DolphinScheduler: standalone server booted (API HTTP 200 after ~50s) and the login endpoint returned a session; the ephemeral smoke container was removed afterwards.

## Boundaries

- Smoke only proves the binaries run on this machine. It is not POC-A/POC-B acceptance, not a compatibility freeze (ADR-007), not a NAS or capacity result.
- The DS smoke used the image's default admin credentials inside an ephemeral container only; any real deployment generates credentials at runtime and never commits them.
- Images are pulled for local experiment only. Enterprise delivery still requires SBOM, CVE scanning and full license/NOTICE clearance per [engineering governance](../../docs/09-engineering-governance.md).
- SeaTunnel connector breadth is not proven by FakeSource; the POC-A run must exercise the actual JDBC source→sink path with checkpoints and retries.

## POC-01 end-to-end result (2026-09-14)

The prior record states that the complete local synthetic run passed after Docker Desktop was upgraded to client/server `29.7.2` (API `1.55`). Its full report was `work/poc01-20260914065750_4de84df7.json`, in the Git-ignored work directory. That file is missing from the checkout inspected on 2026-09-15. The summary below is retained as a historical record; this research task did not rerun the component PoC or reconstruct its missing evidence.

The run started all five services healthy and verified daily ingest, replay idempotency, late arrival rebuild, stale release rejection, scheduler retry success, and four dbt tests. The runner uses explicit dbt project/output paths because the project is mounted read-only. The scheduler PoC also sets a bounded JVM heap/thread configuration; the upstream image default (`-Xms4g -Xmx4g`, about 400 threads) exceeded this experiment's 2 GiB/400-PID container boundary and caused `procReady not received` during the first attempt.

This is a local synthetic-data component result only. It does not prove real DevOps connectivity, NAS deployment, 300 QPS, production security hardening, or delivery license/CVE acceptance.
