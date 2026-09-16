import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJson, dayBounds, digest, durableRename, parseExactJson, readJson, validateDay, withLock } from './lake-runtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_LAKE_ROOT = path.join(ROOT, '.lake-data');
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

function fail(code) { throw new Error(code); }

function parseArgs(argv) {
  const options = { config: null, lakeRoot: DEFAULT_LAKE_ROOT, batchId: null, window: null, dryRun: false };
  const takes = new Set(['--config', '--lake-root', '--batch-id', '--window']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (takes.has(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) fail('INVALID_ARGUMENT_VALUE');
      if (arg === '--config') options.config = path.resolve(ROOT, value);
      if (arg === '--lake-root') options.lakeRoot = path.resolve(ROOT, value);
      if (arg === '--batch-id') options.batchId = value;
      if (arg === '--window') options.window = value;
    } else fail('INVALID_ARGUMENT');
  }
  if (!options.config) fail('API_CONFIG_REQUIRED');
  if (options.batchId && !SAFE.test(options.batchId)) fail('INVALID_BATCH_ID');
  if (options.window) validateDay(options.window);
  return options;
}

function asObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
}

function valueAt(value, pointer) {
  if (pointer === undefined || pointer === null || pointer === '') return value;
  if (typeof pointer !== 'string' || pointer.length > 300) fail('INVALID_RECORDS_PATH');
  const parts = pointer.startsWith('/')
    ? pointer.split('/').slice(1).map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    : pointer.split('.').filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (Array.isArray(current) && /^\d+$/u.test(part)) current = current[Number(part)];
    else if (current && typeof current === 'object') current = current[part];
    else return undefined;
  }
  return current;
}

function hostAllowed(url, allowedHosts) {
  return allowedHosts.includes(url.hostname.toLowerCase());
}

function validateUrl(raw, allowedHosts, baseOrigin, code = 'API_URL_NOT_ALLOWED') {
  let url;
  try { url = new URL(raw, baseOrigin); } catch { fail(code); }
  const localHttp = url.protocol === 'http:' && new Set(['localhost', '127.0.0.1', '[::1]']).has(url.hostname.toLowerCase());
  if (url.protocol !== 'https:' && !localHttp) fail('API_TLS_REQUIRED');
  if (!hostAllowed(url, allowedHosts)) fail(code);
  if (url.username || url.password) fail('API_URL_CREDENTIALS_FORBIDDEN');
  if (url.origin !== new URL(baseOrigin).origin) fail('API_ORIGIN_CHANGE_FORBIDDEN');
  return url;
}

function validateConfig(config) {
  asObject(config, 'INVALID_API_CONFIG');
  if (config.version !== 1 || typeof config.source_code !== 'string' || !SAFE.test(config.source_code)) fail('INVALID_API_CONFIG_VERSION_OR_SOURCE');
  if (typeof config.base_url !== 'string') fail('API_BASE_URL_REQUIRED');
  let base;
  try { base = new URL(config.base_url); } catch { fail('API_BASE_URL_INVALID'); }
  const allowedHosts = Array.isArray(config.allowed_hosts) ? config.allowed_hosts : [base.hostname];
  if (allowedHosts.length === 0 || allowedHosts.some((host) => typeof host !== 'string' || !/^[A-Za-z0-9.-]+$/u.test(host))) fail('API_ALLOWED_HOSTS_INVALID');
  const baseUrl = validateUrl(base.toString(), allowedHosts.map((host) => host.toLowerCase()), base.toString(), 'API_BASE_URL_NOT_ALLOWED');
  if (typeof config.path !== 'string' || !config.path.startsWith('/') || config.path.includes('..')) fail('API_PATH_INVALID');
  if (config.method !== undefined && config.method !== 'GET') fail('API_METHOD_MUST_BE_GET');
  if (config.query !== undefined) {
    if (!config.query || typeof config.query !== 'object' || Array.isArray(config.query)) fail('API_QUERY_INVALID');
    for (const [key, value] of Object.entries(config.query)) {
      if (!/^[A-Za-z0-9_.-]{1,80}$/u.test(key) || typeof value === 'object') fail('API_QUERY_INVALID');
      if (/(token|secret|password|authorization|cookie|api[-_]?key)/iu.test(key)) fail('API_QUERY_SECRET_FORBIDDEN');
    }
  }
  if (config.auth_env !== undefined && (typeof config.auth_env !== 'string' || !ENV_NAME.test(config.auth_env))) fail('API_AUTH_ENV_INVALID');
  if (config.auth_header !== undefined && (typeof config.auth_header !== 'string' || !/^[A-Za-z][A-Za-z0-9-]{0,63}$/u.test(config.auth_header))) fail('API_AUTH_HEADER_INVALID');
  const pagination = config.pagination ?? { mode: 'none' };
  asObject(pagination, 'API_PAGINATION_INVALID');
  if (!new Set(['none', 'page', 'offset', 'next', 'token']).has(pagination.mode)) fail('API_PAGINATION_MODE_INVALID');
  const maxPages = pagination.max_pages ?? 1000;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100000) fail('API_MAX_PAGES_INVALID');
  const pageSize = pagination.page_size ?? 100;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 10000) fail('API_PAGE_SIZE_INVALID');
  if (pagination.records_path !== undefined && typeof pagination.records_path !== 'string') fail('API_RECORDS_PATH_INVALID');
  if (['next', 'token'].includes(pagination.mode) && !pagination.next_path) fail('API_NEXT_PATH_REQUIRED');
  if (pagination.mode === 'token' && (typeof pagination.cursor_param !== 'string' || !pagination.cursor_param)) fail('API_CURSOR_PARAM_REQUIRED');
  if (config.success && (typeof config.success.path !== 'string' || !Object.hasOwn(config.success, 'equals'))) fail('API_SUCCESS_CONTRACT_INVALID');
  const timeout = config.timeout_seconds ?? 60;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300) fail('API_TIMEOUT_INVALID');
  const maxResponseBytes = config.max_response_bytes ?? 50 * 1024 * 1024;
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1024 || maxResponseBytes > 1024 * 1024 * 1024) fail('API_MAX_RESPONSE_BYTES_INVALID');
  const retry = config.retry ?? {};
  if (!Number.isInteger(retry.max_attempts ?? 3) || (retry.max_attempts ?? 3) < 1 || (retry.max_attempts ?? 3) > 8) fail('API_RETRY_INVALID');
  if (!Number.isInteger(retry.max_delay_ms ?? 60000) || (retry.max_delay_ms ?? 60000) < 0 || (retry.max_delay_ms ?? 60000) > 60000) fail('API_RETRY_DELAY_INVALID');
  if (!Number.isFinite(config.requests_per_second ?? 5) || (config.requests_per_second ?? 5) < 0.1 || (config.requests_per_second ?? 5) > 100) fail('API_RATE_LIMIT_INVALID');
  return { ...config, baseUrl, allowedHosts: allowedHosts.map((host) => host.toLowerCase()), pagination: { mode: 'none', ...pagination, max_pages: maxPages, page_size: pageSize }, timeout_seconds: timeout, max_response_bytes: maxResponseBytes, retry: { max_attempts: retry.max_attempts ?? 3, max_delay_ms: retry.max_delay_ms ?? 60000 } };
}

function buildInitialUrl(config, windowValue) {
  const url = new URL(config.path, config.baseUrl);
  if (config.query && typeof config.query === 'object' && !Array.isArray(config.query)) {
    for (const [key, value] of Object.entries(config.query)) {
      if (!/^[A-Za-z0-9_.-]{1,80}$/u.test(key) || typeof value === 'object') fail('API_QUERY_INVALID');
      if (/(token|secret|password|authorization|cookie|api[-_]?key)/iu.test(key)) fail('API_QUERY_SECRET_FORBIDDEN');
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }
  if (windowValue && config.window) {
    const fromParam = config.window.from_param;
    const toParam = config.window.to_param;
    const bounds = dayBounds(windowValue);
    if (fromParam) url.searchParams.set(fromParam, config.window.format === 'date' ? windowValue : bounds.start);
    if (toParam) url.searchParams.set(toParam, config.window.format === 'date' ? bounds.nextDay : bounds.end);
  }
  return validateUrl(url.toString(), config.allowedHosts, config.baseUrl.toString());
}

function buildPageUrl(url, config, page, offset) {
  const next = new URL(url.toString());
  if (config.pagination.mode === 'page') {
    next.searchParams.set(config.pagination.page_param ?? 'page', String(page));
    next.searchParams.set(config.pagination.size_param ?? 'size', String(config.pagination.page_size));
  } else if (config.pagination.mode === 'offset') {
    next.searchParams.set(config.pagination.offset_param ?? 'offset', String(offset));
    next.searchParams.set(config.pagination.limit_param ?? 'limit', String(config.pagination.page_size));
  }
  return next;
}

function getNextUrl(payload, currentUrl, config) {
  const pointer = config.pagination.next_path;
  if (!pointer) return null;
  const raw = valueAt(payload, pointer);
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') fail('API_NEXT_LINK_INVALID');
  const next = validateUrl(raw, config.allowedHosts, currentUrl.toString(), 'API_NEXT_LINK_NOT_ALLOWED');
  assertSafeQuery(next, config);
  return next;
}

function retryDelay(response, attempt, config) {
  const header = response.headers.get('retry-after');
  const retryAfter = header === null ? NaN : Number(header);
  const dateDelay = header === null ? NaN : Date.parse(header) - Date.now();
  const configured = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : Number.isFinite(dateDelay) ? Math.max(0, dateDelay) : 250 * (2 ** (attempt - 1));
  return Math.min(config.retry.max_delay_ms, configured);
}

async function sleep(ms) { if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms)); }

async function readBody(response, maxBytes) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      fail('API_RESPONSE_TOO_LARGE');
    }
    chunks.push(Buffer.from(next.value));
  }
  return Buffer.concat(chunks);
}

async function requestJson(url, config, token) {
  for (let attempt = 1; attempt <= config.retry.max_attempts; attempt += 1) {
    await sleep(Math.max(0, (config.lastRequestAt ?? 0) + 1000 / (config.requests_per_second ?? 5) - Date.now()));
    config.lastRequestAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeout_seconds * 1000);
    const headers = { accept: 'application/json' };
    if (config.auth_env) headers[config.auth_header ?? 'Authorization'] = `${config.auth_prefix ?? 'Bearer '}${token}`;
    try {
      const response = await fetch(url, { method: config.method ?? 'GET', headers, signal: controller.signal, redirect: 'error' });
      const body = await readBody(response, config.max_response_bytes);
      if (RETRY_STATUSES.has(response.status) && attempt < config.retry.max_attempts) {
        await sleep(retryDelay(response, attempt, config));
        continue;
      }
      if (!response.ok) fail(`API_HTTP_${response.status}`);
      return { body, status: response.status };
    } catch (error) {
      if (error?.name === 'AbortError') {
        if (attempt < config.retry.max_attempts) { await sleep(Math.min(config.retry.max_delay_ms, 250 * (2 ** (attempt - 1)))); continue; }
        fail('API_TIMEOUT');
      }
      if (String(error?.message ?? '').startsWith('API_')) throw error;
      if (attempt < config.retry.max_attempts) { await sleep(Math.min(config.retry.max_delay_ms, 250 * (2 ** (attempt - 1)))); continue; }
      fail('API_REQUEST_FAILED');
    } finally { clearTimeout(timer); }
  }
  fail('API_RETRY_EXHAUSTED');
}

function recordsFrom(payload, config) {
  const records = valueAt(payload, config.pagination.records_path);
  if (!Array.isArray(records)) fail('API_RECORDS_ARRAY_REQUIRED');
  for (const record of records) if (!record || typeof record !== 'object' || Array.isArray(record)) fail('API_RECORD_MUST_BE_OBJECT');
  return records;
}

async function sha256File(file) {
  const bytes = await readFile(file);
  return { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function tokenFromEnv(config, dryRun) {
  if (!config.auth_env) return null;
  if (dryRun) return '<configured-secret-reference>';
  const token = process.env[config.auth_env];
  if (!token) fail('API_AUTH_ENV_MISSING');
  return token;
}

async function runUnlocked(options) {
  const configText = await readFile(options.config, 'utf8');
  const config = validateConfig(JSON.parse(configText));
  const configSha256 = digest(configText);
  const ledgerKey = `${config.source_code}|${configSha256}|${options.window}`;
  const ledgerPath = path.join(options.lakeRoot, 'api-ledger.json');
  if (options.window && !options.dryRun) {
    const ledger = await readJson(ledgerPath, { version: 2, windows: {} });
    const existing = ledger.windows?.[ledgerKey];
    if (existing?.state === 'COMPLETE') {
      const previous = await readJson(path.join(options.lakeRoot, 'api', config.source_code, existing.batchId, 'batch.json'));
      for (const page of previous.pages) {
        for (const asset of [page.raw, page.normalized]) {
          const actual = await sha256File(path.join(options.lakeRoot, asset.path));
          if (actual.sha256 !== asset.sha256 || actual.bytes !== asset.bytes) fail('API_RAW_INTEGRITY_MISMATCH');
        }
      }
      return { ...previous, reused: true };
    }
  }
  const token = await tokenFromEnv(config, options.dryRun);
  const batchId = options.batchId ?? `api-${new Date().toISOString().replace(/[-:.TZ]/gu, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  if (!SAFE.test(batchId)) fail('INVALID_BATCH_ID');
  const firstUrl = buildInitialUrl(config, options.window);
  assertSafeQuery(firstUrl, config);
  const manifest = { version: 1, batchId, sourceCode: config.source_code, mode: 'REST', window: options.window ?? null, state: options.dryRun ? 'DRY_RUN' : 'RUNNING', startedAt: new Date().toISOString(), pages: [], pagination: config.pagination.mode, configSha256, scalarEncoding: 'exact-json-v1' };
  if (options.dryRun) return { ...manifest, request: { method: config.method ?? 'GET', url: firstUrl.origin + firstUrl.pathname, auth: config.auth_env ? 'environment-reference' : 'none' } };
  const batchRoot = path.join(options.lakeRoot, 'api', config.source_code, batchId);
  const pageRoot = path.join(batchRoot, 'pages');
  await mkdir(path.dirname(batchRoot), { recursive: true, mode: 0o700 });
  try { await mkdir(batchRoot, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') fail('API_BATCH_EXISTS'); throw error; }
  await mkdir(pageRoot, { mode: 0o700 });
  let url = firstUrl;
  let page = config.pagination.mode === 'page' ? (config.pagination.start_page ?? 1) : 1;
  let offset = config.pagination.mode === 'offset' ? (config.pagination.start_offset ?? 0) : 0;
  const visited = new Set();
  const pageHashes = new Set();
  let totalRows = 0;
  try {
    let followNextDirect = false;
    while (url) {
      if (manifest.pages.length >= config.pagination.max_pages) fail('API_MAX_PAGES_EXCEEDED');
      const requestUrl = followNextDirect ? url : buildPageUrl(url, config, page, offset);
      followNextDirect = false;
      if (visited.has(requestUrl.toString())) fail('API_PAGINATION_LOOP');
      visited.add(requestUrl.toString());
      const response = await requestJson(requestUrl, config, token);
      const index = manifest.pages.length + 1;
      const rawPath = path.join(pageRoot, `page-${String(index).padStart(6, '0')}.json`);
      const recordsPath = path.join(pageRoot, `page-${String(index).padStart(6, '0')}.jsonl`);
      await writeFile(`${rawPath}.part`, response.body, { mode: 0o600, flag: 'wx' });
      await durableRename(`${rawPath}.part`, rawPath);
      const raw = await sha256File(rawPath);
      const pageEntry = { page: index, request: { url: requestUrl.origin + requestUrl.pathname, queryKeys: [...requestUrl.searchParams.keys()] }, status: response.status, state: 'RAW_COMMITTED', raw: { path: path.relative(options.lakeRoot, rawPath), ...raw } };
      manifest.pages.push(pageEntry);
      await atomicJson(path.join(batchRoot, 'batch.json.part'), manifest);
      let payload; try { payload = parseExactJson(response.body.toString('utf8')); } catch { fail('API_RESPONSE_NOT_JSON'); }
      if (config.success && valueAt(payload, config.success.path) !== config.success.equals) fail('API_BUSINESS_ERROR');
      const records = recordsFrom(payload, config);
      if (records.length && pageHashes.has(raw.sha256)) fail('API_DUPLICATE_PAGE');
      pageHashes.add(raw.sha256);
      const lines = records.map((record) => JSON.stringify(record, null, 0)).join('\n');
      await writeFile(`${recordsPath}.part`, lines ? `${lines}\n` : '', { mode: 0o600, flag: 'wx' });
      await durableRename(`${recordsPath}.part`, recordsPath);
      const normalized = await sha256File(recordsPath);
      Object.assign(pageEntry, { rows: records.length, state: 'PARSED', normalized: { path: path.relative(options.lakeRoot, recordsPath), ...normalized } });
      await atomicJson(path.join(batchRoot, 'batch.json.part'), manifest);
      totalRows += records.length;
      if (config.pagination.mode === 'token') {
        const cursor = valueAt(payload, config.pagination.next_path);
        if (cursor === null || cursor === undefined || cursor === '') url = null;
        else {
          if (!['string', 'number'].includes(typeof cursor)) fail('API_CURSOR_INVALID');
          url = new URL(firstUrl); url.searchParams.set(config.pagination.cursor_param, String(cursor));
          followNextDirect = true;
        }
        continue;
      }
      const explicitNext = getNextUrl(payload, requestUrl, config);
      if (config.pagination.mode === 'next') { url = explicitNext; followNextDirect = Boolean(explicitNext); }
      else if (explicitNext) { url = explicitNext; followNextDirect = true; }
      else if (config.pagination.mode === 'page' && records.length >= config.pagination.page_size) { page += 1; url = firstUrl; }
      else if (config.pagination.mode === 'offset' && records.length >= config.pagination.page_size) { offset += records.length; url = firstUrl; }
      else url = null;
    }
    manifest.state = 'COMPLETE';
    manifest.rowCount = totalRows;
    manifest.finishedAt = new Date().toISOString();
    await atomicJson(path.join(batchRoot, 'batch.json'), manifest);
    if (options.window) {
      const ledger = await readJson(ledgerPath, { version: 2, windows: {} });
      ledger.windows[ledgerKey] = { batchId, state: 'COMPLETE', finishedAt: manifest.finishedAt, pageCount: manifest.pages.length, rowCount: totalRows };
      await atomicJson(ledgerPath, ledger);
    }
    return manifest;
  } catch (error) {
    manifest.state = 'FAILED';
    manifest.errorCode = String(error?.message ?? 'API_INGEST_FAILED').replace(/[^A-Z0-9_:-]/giu, '_').slice(0, 120);
    manifest.failedAt = new Date().toISOString();
    await atomicJson(path.join(batchRoot, 'batch.failed.json'), manifest);
    throw error;
  }
}

function assertSafeQuery(url, config) {
  for (const key of url.searchParams.keys()) {
    if (key !== config.pagination.cursor_param && /(token|secret|password|authorization|cookie|api[-_]?key)/iu.test(key)) fail('API_QUERY_SECRET_FORBIDDEN');
  }
}

export async function run(options) {
  if (options.window) validateDay(options.window);
  return options.dryRun ? runUnlocked(options) : withLock(path.join(options.lakeRoot, 'api-ingest.lock'), () => runUnlocked(options));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await run(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify({ batchId: result.batchId, sourceCode: result.sourceCode, state: result.state, pages: result.pages?.length ?? 0, rowCount: result.rowCount ?? null, window: result.window }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAILED', errorCode: String(error?.message ?? 'API_INGEST_FAILED').replace(/[^A-Z0-9_:-]/giu, '_').slice(0, 120) }));
    process.exitCode = 1;
  }
}

export { buildInitialUrl, buildPageUrl, getNextUrl, parseArgs, recordsFrom, validateConfig, valueAt };
