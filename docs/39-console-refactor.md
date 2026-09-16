# UI-03 Console readability and state ownership

Status: in progress. User approved implementation of the Pinia refactor on 2026-09-16.

Scope: console source, frontend tests, dependency records and related documentation.
No backend API, database, Worker, business calculation or production deployment changes.
No generic Model/Repository layer. The datasets feature is a business workspace.

## Dependency baseline before installation

Official npm metadata checked before installation. Exact development versions:
ESLint 10.10.0, @eslint/js 10.0.1, typescript-eslint 8.70.0,
eslint-plugin-vue 10.11.0, vue-eslint-parser 10.4.1,
@stylistic/eslint-plugin 5.10.0, globals 17.12.0, Prettier 3.9.7.
All declare MIT. Node minimum becomes 22.13; existing host 22.23.2 and
container 22.23.1 meet this requirement. Vue/TypeScript/Vite remain unchanged.
Pinia 3.0.4 (MIT) is selected for the state migration; Vue peer ^3.5.11 is met.
Lockfile and full transitive license/integrity verification precede installation.
Installation scripts remain disabled. This is not distribution/legal approval.
ESLint's minimatch 10.2.6 is development-only and declares BlueOak-1.0.0.
Its license grants copyright and patent permissions without a source-disclosure
requirement; distribution must include its license text or license URL.
The checker exception is limited to this exact development package/version.
It does not enter static runtime assets or extend the general license allowlist.

## Work packages

1. ESLint and mechanical formatting, without behavior changes.
2. Pinia session/project stores, typed API and request lifecycle boundaries.
3. Dataset query snapshot and explicit business forms; separate dataset panels.
4. Separate sources/plans/executions pages, application layout and local styles.
5. Regression tests, dependency notices, documentation and staged secret review.

## Invariants and completion gates

Credentials remain memory-only. Old responses and stale 401s cannot affect a new
session/project. Backend authorization remains authoritative. Query pagination
and export preserve submitted scope and release. Expected-version conflicts keep
form input. Confirmations and required reasons remain. No new global result cache.

ESLint owns JS/TS/Vue formatting; Prettier owns standalone CSS only. A one-time
mechanical formatting pass may seed the existing compressed source before ESLint.
Check lint with zero warnings, CSS format, typecheck/build, unit and browser tests,
docs links, diff whitespace, exact dependency metadata and sensitive staged content.
Existing full-suite Windows failures and unavailable real API integration must be
reported separately, not counted as passing.

Rollback uses the preceding frontend commit and matching static assets; no data
migration, data deletion or release-pointer changes are part of this work.

## Stage A verification

Completed: ESLint zero warnings, CSS formatting, TypeScript/build and runtime
notices; 24/24 Edge Playwright tests; 8/8 focused Node tests; docs and diff checks.
202 exact dependencies matched official metadata. No human peer review.
Development Vite still reports the previously documented ResizeObserver warning.
