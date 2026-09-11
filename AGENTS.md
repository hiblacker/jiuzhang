# Repository instructions for AI coding agents

## Scope and current stage

This is a general-purpose reporting data center. DevOps is the first business domain, not the platform core. Read README.md, docs/02-architecture.md, docs/03-data-processing.md, docs/07-decisions-risks.md and docs/09-engineering-governance.md before implementation. Current repository contains a documentation baseline and an isolated synthetic SQL PoC; it is not a production platform.

## Before changing code

- Inspect git status and applicable instructions; preserve existing user edits.
- Identify the work package, acceptance criteria and allowed write scope. Ask only for genuinely blocking ambiguity; do not invent source APIs, credentials, production history or business rules.
- Follow the recommended stack in document 09, but do not install unpinned or unapproved dependencies. Exact experiment versions must be recorded before PoC.
- Do not spawn agents unless the user separately authorizes delegation.
- Work on a short feature/fix/docs/poc branch; do not reset, force-push or delete branches/work without authorization. Creating a remote repository or pushing requires user direction.
- Local merges to `main` are pre-authorized once all completion checks pass (tests, `node tools/check-docs.mjs`, `git diff --check`, staged sensitive-content scan) — no per-merge approval needed (see CONTRIBUTING.md local merge autonomy, user-authorized 2026-09-11). Every such merge must state that no human peer review occurred; this does not constitute release, acceptance or production approval.

## Design and security

- Keep DevOps-specific statuses, joins and formulas in domain models, not platform adapters.
- Separate control API, execution workers and reporting access; no long ETL in an HTTP handler.
- No arbitrary user SQL/shell. Parameterize values; allowlist identifiers and query operations; enforce limits and server-side row/column access.
- Never commit secrets, production payloads or unredacted logs. Use synthetic fixtures and credential references. Do not log secrets.
- No schema auto-update in production. Version migrations, preserve executed migration files and document forward recovery.
- No undeclared dependencies or components with unknown/unreviewed licenses. Check direct/transitive dependencies, connectors, drivers and runtime images, not just the root repository LICENSE.

## Data correctness

- Define model grain and uniqueness keys; preserve origin, event time, ingestion time and batch.
- Use half-open time windows and explicit business timezone.
- Do not infer unavailable historical states from current-state data.
- Do not invent null/negative/delete/status rules. Do not sum daily distinct counts, percentages, means, percentiles or end-of-period snapshots into monthly results.
- Preserve numerator, denominator and valid sample counts; zero denominator yields the approved null semantics.
- Changes must cover duplicate replay, late arrival, reopen, team history, date boundaries and missing snapshots where applicable.
- Build and validate new dataset versions before atomic publication; stale runs cannot overwrite newer releases. Query, drilldown and caches preserve release and authorization scope.

## Verification and completion

- Commit code, tests, contract/business-rule changes and migration/recovery notes together.
- Run relevant tests and static/type checks; run `node tools/check-docs.mjs` and `git diff --check` for documentation. Report exact checks and untested areas; never claim tools/CI/deployment/approval were run when they were not.
- Current check-docs script checks local links and research evidence, not application correctness, license clearance or remote branch protection.
- Review staged diff and sensitive content before each meaningful commit. Use conventional commit messages and report commit IDs.
- Do not delete PoC code by default. Preserve experiments/results; promote reusable code only after production-hardening tests and review.
- No production deployment, database cleanup, remote push or tag publication without explicit instruction.
