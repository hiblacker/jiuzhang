# Synthetic SQL PoC (P0)

This directory is a preserved experiment, not a production service or a replacement for the Java/Naive UI platform stack. See [scope and synthetic business rules](../../docs/17-synthetic-sql-poc.md).

## Run locally

From the repository root, with the pinned existing Node runtime and Docker Desktop running:

```powershell
node --test tests/*.test.mjs
node poc/synthetic-sql/run.mjs
```

The runner verifies SQL checksums and the exact cached image, generates a password only if absent in ignored `secrets/`, validates Compose, then starts **only** project `bdw-synthetic-p0`. It never pulls images, uses a host port, accesses the real source, or deploys NAS. The container listens only on its local Unix socket. A new randomly suffixed `p0_...` database is created per run; existing databases are not cleared. Local privileged Docker access is trusted in this experiment; this is not a hardened production security boundary.

Actual versions and license review limits: [dependency lock](dependencies.lock.json). Local Compose is 2.32.4-desktop.1, not the NAS-selected 2.40.3. The image digest is a manifest digest; the runner also verifies local image ID and architecture. No third-party Node modules.

## Artifacts and boundaries

- `migrations/`: forward-only DDL, installed transactionally and recorded with SHA-256 in `public.p0_migration`. Never modify an executed migration; add a new numbered migration.
- `models/lifecycle.sql`: generic lifecycle SQL for this model family, **not** a universal metric engine. A future financial domain may use different typed models and reuse the release mechanism.
- `fixtures/baseline.sql`: synthetic source/domain mapping, objects, fixed team history, and baseline events. These state changes are explicitly known synthetic transitions; single-label real DevOps logs do not automatically qualify.
- `sql.lock.json`: exact reviewed experiment inputs. A changed test/model needs a new reviewed checksum and run; never silently regenerate on startup. Production rules will have independent versioned artifacts.
- `tests/acceptance.sql`: golden values and database-side negative assertions; runner also uses two independent concurrent publication sessions.
- `work/synthetic-p0-*.json` (ignored, at repository root): individual results, rule digest, isolated database name, assertions and synthetic metric rows. Failure keeps the database and previous publications intact.

This P0 uses an admin test connection for migration/worker execution; reporting is tested with distinct **NOLOGIN** session identities. No login credentials, API, authentication service or connection pool is delivered. Report identities can only read authorized views; raw tables, publish functions and role escalation are denied. They are trusted SQL consumers, not an arbitrary-SQL HTTP endpoint. Query budgets, real login limits, worker-vs-publisher separation and audit hardening are still required before serving users.

## SQL reporting contract

Resolve `reporting.current_release` once and bind that ID for all metric, event and snapshot queries in the report. Read `reporting.metrics` for `period_id`, `domain`, `team` and that `release_id`; use `reporting.events` for completion contributions with the same half-open time window; use `reporting.snapshots` for end stock. A separate current-release read for each query may mix revisions and is not a valid report workflow. There is no cache in P0.

Only PUBLISHED releases are visible. Authorization uses the database `session_user` plus a private scope table, not a caller-set tenant variable. Changing SET ROLE does not select another tenant. Zero duration denominator and incomplete history remain NULL with reason columns. Monthly distincts are recomputed within each team; cross-team distinct totals must be recomputed from authorized object details, not summed.

## Inspect and stop (non-destructive)

```powershell
docker compose -f poc/synthetic-sql/compose.yaml ps
docker compose -f poc/synthetic-sql/compose.yaml stop
```

Use the database name in the retained run report and a container-local psql session for manual inspection. No database or volume deletion is automated. Each rerun consumes some additional storage; explicit retention/cleanup approval will be needed for long-running use. Do not use `down -v` as an ordinary reset.

## Forward recovery

DDL is transactional; failed migration does not leave a partially recorded version. This runner intentionally migrates only freshly created experiment databases, **not** existing/production instances. To test an upgrade, add V003+, implement a checksum-validated existing-database migrator and rehearse restore/forward-fix before promotion. Published content cannot be changed or reclassified to BUILDING; rebuild a new release and atomically switch after validation/approval. Failed builds do not move the pointer; compare-and-swap rejects stale jobs. A superuser still controls the entire database and is outside this PoC threat boundary.

The fixed object registry, status mappings, period definitions and team history are immutable experiment inputs tied to the SQL digest; only events are watermarked. Live ingestion of changing dimensions, history corrections and versioned approvals needs a later slice. No capacity, NAS, vulnerability, full license or human acceptance result is implied by passing synthetic assertions.
