# UI-03 Console readability and state ownership

Status: implementation and local isolated verification complete, 2026-09-16.
User approved implementation of the Pinia refactor on 2026-09-16.

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

## Completed structure and state ownership

- `app`: application shell, navigation, connection dialog and session coordination.
- `stores`: Pinia session and project state; roles drive UI visibility only.
- `features`: overview, sources, plans, executions, assets, datasets and access.
  Each feature owns its typed API, pages and explicit forms where needed.
- `shared`: reusable table/drawer, form validation, request lifecycle and base CSS.
- `api`: transport and request types, independent of Pinia and application assembly.
  ESLint rejects reverse imports from API modules into stores, Vue or `app`.

Tokens live in the session coordinator's memory closure, outside Pinia state and
action arguments. Project/session generations synchronously cancel old page requests;
the shell remounts scoped pages, clearing drafts, results and dialogs. Form drafts
and query results remain local, not duplicated in stores or a generic Model layer.
Dataset queries clone submitted filters/columns and pin the returned release for
pagination and export. Failed pagination preserves the displayed page/export pair.
Model conflicts retain drafts; reopening a dialog starts from its explicit inputs.

## Final verification and boundaries

Windows, Node 22.23.2 and installed Microsoft Edge, 2026-09-16:

- `npm run check`: zero-warning ESLint, CSS formatting, 12/12 unit tests,
  TypeScript, Vite build and 58 runtime dependency notices passed.
- `PLAYWRIGHT_CHANNEL=msedge npm test`: 26/26 browser tests passed, including
  model conflict draft preservation and project switching during a dataset query.
- `CONSOLE_URL=http://127.0.0.1:4174 PLAYWRIGHT_CHANNEL=msedge npx --no-install playwright test`:
  the same 26/26 tests passed against compiled assets served by the local Node server.
- `npm run licenses`: 214 exact dependencies matched official integrity and
  license declarations; this is not organizational distribution approval.
- `node --test tests/console-transport.test.mjs tests/console-server.test.mjs tests/docker-image-policy.test.mjs`:
  8/8 passed.
- `npm audit --package-lock-only --registry https://registry.npmjs.org`:
  zero known vulnerabilities. The configured npm mirror has no audit endpoint;
  its failed audit attempt was retried against the official registry.
- Desktop/mobile layout checks cover seven workspaces at 1440 and 390 pixels,
  plus the plan form at 320 pixels. Screenshots contain synthetic fixtures only.
- `node tools/check-docs.mjs`: 50 Markdown files and 13 research records passed.
  Working/staged diff whitespace checks passed. Staged diff review and known-secret
  pattern/path checks found no real credentials, runtime data or generated binaries;
  this scoped scan is not an enterprise DLP guarantee.

Root regression evidence remains 114 tests: 80 passed, 33 failed, 1 skipped.
Failure names match the 33 failures in the unchanged `11322a0` Windows baseline;
the current and baseline logs are `work/ui03-root-tests.log` and
`work/ui02-baseline-tests.log`. These failures are not reported as passing.
The refactor stays on its feature branch rather than automatically merging to main.

Console package version is 0.2.1; the next image tag is `0.2.1-dev.1`.
Docker build now runs `npm run check`, but the new image has not been built or
deployed. Real Java API/Worker/database integration, Linux container runtime,
NAS, capacity and production verification remain outside this result.
No human peer review, remote push, tag publication or production deployment occurred.
This work changes no backend contract, database migration or business calculation.
