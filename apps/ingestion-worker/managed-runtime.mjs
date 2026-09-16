import { mkdir, readdir, realpath, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson, digest, readJson, resolveInside, parseExactJson } from '../../tools/lake-runtime.mjs';
import { discover } from '../../tools/lake-discover.mjs';
import { buildInventoryRequest } from '../../tools/lake-register.mjs';
import { validateContract } from '../../tools/file-delivery.mjs';
import { validateConfig, buildInitialUrl, requestJson, recordsFrom, valueAt, tokenFromEnv } from '../../tools/rest-ingest.mjs';

const fail = code => { throw new Error(code); };
const CODE = /^[a-z][a-z0-9_-]{1,99}$/u;

export function validateManagedRegistry(value) {
  if (value.version !== 2 || !CODE.test(value.environment ?? '') || value.environment.length > 71
      || !path.isAbsolute(value.lakeRoot ?? '') || !value.resources || Array.isArray(value.resources)
      || Object.keys(value.resources).length > 1000) fail('INVALID_MANAGED_REGISTRY');
  for (const [key, resource] of Object.entries(value.resources)) {
    if (!CODE.test(key) || !CODE.test(resource.resourceGroup ?? '')
        || !['MYSQL_SNAPSHOT','FILE_SCAN','REST_PULL'].includes(resource.kind)) fail('INVALID_MANAGED_RESOURCE');
    const file = resource.kind === 'FILE_SCAN' ? resource.inboxRoot : resource.config;
    if (!path.isAbsolute(file ?? '')) fail('RUNTIME_PATH_MUST_BE_ABSOLUTE');
    if (resource.tokenFile && !path.isAbsolute(resource.tokenFile)) fail('RUNTIME_PATH_MUST_BE_ABSOLUTE');
    if (resource.maxBytes !== undefined && (!Number.isSafeInteger(resource.maxBytes) || resource.maxBytes < 1024)) fail('INVALID_MANAGED_RESOURCE_LIMIT');
  }
  return value;
}

function scopeInventory(inventory, tables) {
  if (!tables?.length) return inventory;
  const found = inventory.tables.filter(t => tables.includes(t.table));
  if (found.length !== tables.length) fail('SELECTED_TABLE_NOT_FOUND');
  return { ...inventory, tables: found, required_table_count: found.length };
}

export async function managedProfile(registry, task) {
  if (typeof task.configurationJson !== 'string' || task.configurationJson.length > 100000
      || digest(task.configurationJson) !== task.configurationSha256) fail('CONFIGURATION_DIGEST_MISMATCH');
  const config = JSON.parse(task.configurationJson), resource = registry.resources?.[config.resourceRef];
  if (config.protocol !== 2 || config.environment !== registry.environment || !resource
      || resource.kind !== config.kind || resource.resourceGroup !== config.resourceGroup
      || !CODE.test(config.sourceCode) || (task.source_code && config.sourceCode !== task.source_code)
      || (task.kind && config.kind !== task.kind)) fail('MANAGED_RESOURCE_SCOPE_MISMATCH');
  const root = path.join(registry.lakeRoot, 'managed-configurations', config.sourceCode, String(config.channelVersion));
  await mkdir(root, { recursive: true, mode: 0o700 });
  const maxBytes = Math.min(config.maxBytes, resource.maxBytes ?? config.maxBytes);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024) fail('INVALID_MANAGED_RESOURCE_LIMIT');
  const profile = { kind: config.kind, sourceCode: config.sourceCode, resourceGroup: config.resourceGroup };
  if (config.kind === 'MYSQL_SNAPSHOT') {
    const secret = await readJson(resource.config);
    if (config.connection.database !== secret.database) fail('DATABASE_OUTSIDE_APPROVED_RESOURCE');
    const tables = config.channel.tables;
    if (tables !== undefined && (!Array.isArray(tables) || new Set(tables).size !== tables.length
        || tables.some(t => typeof t !== 'string' || !t || t.length > 64))) fail('INVALID_TABLE_SCOPE');
    if (resource.allowedTables && (!tables?.length || tables.some(t => !resource.allowedTables.includes(t)))) fail('TABLE_OUTSIDE_APPROVED_RESOURCE');
    Object.assign(profile, { config: resource.config, allowUnverifiedTestTls: resource.allowUnverifiedTestTls === true,
      mysqlCli: resource.mysqlCli, maxSnapshotBytes: maxBytes, tables });
  } else if (config.kind === 'FILE_SCAN') {
    const relative = config.channel.relativeDirectory ?? '';
    if (typeof relative !== 'string' || relative.includes('\\') || relative.startsWith('/') || relative.split('/').includes('..')) fail('DIRECTORY_OUTSIDE_RESOURCE');
    const inboxRoot = relative ? await resolveInside(resource.inboxRoot, relative) : await realpath(resource.inboxRoot);
    const delivery = validateContract(config.channel.delivery);
    const contractFile = path.join(root, 'delivery.json');
    await immutableJson(contractFile, delivery);
    Object.assign(profile, { inboxRoot, datePartitioned: config.channel.datePartitioned === true,
      deliveryContract: contractFile, parserPython: resource.parserPython, maxFileBytes: maxBytes,
      maxRows: resource.maxRows ?? 10000000 });
  } else {
    const base = await readJson(resource.config);
    if (resource.allowedPaths && !resource.allowedPaths.includes(config.channel.path)) fail('API_PATH_OUTSIDE_RESOURCE');
    const api = { ...base, ...config.channel, source_code: config.sourceCode,
      max_response_bytes: Math.min(base.max_response_bytes ?? 1048576, maxBytes),
      requests_per_second: Math.min(base.requests_per_second ?? 5, config.requestsPerSecond),
      // Credentials and network targets can only come from the local administrator registry.
      version: 1, base_url: base.base_url, allowed_hosts: base.allowed_hosts,
      auth_env: base.auth_env, auth_header: base.auth_header, auth_prefix: base.auth_prefix };
    validateConfig(api);
    const file = path.join(root, 'api.json'); await immutableJson(file, api);
    Object.assign(profile, { config: file });
    if (resource.tokenFile) {
      if (!api.auth_env) fail('API_AUTH_REFERENCE_REQUIRED');
      const secret = (await readFile(resource.tokenFile, 'utf8')).trim();
      if (!secret || secret.length > 4096 || /[\r\n]/u.test(secret)) fail('API_CREDENTIAL_INVALID');
      profile.environment = { [api.auth_env]: secret };
    }
  }
  return profile;
}

async function immutableJson(file, value) {
  const previous = await readJson(file, null);
  if (previous && JSON.stringify(previous) !== JSON.stringify(value)) fail('MANAGED_CONFIGURATION_IMMUTABLE');
  if (!previous) await atomicJson(file, value);
}

export async function probeManaged(registry, task) {
  const profile = await managedProfile(registry, task);
  if (profile.kind === 'MYSQL_SNAPSHOT') {
    const inventory = scopeInventory(await discover(profile, task.inventoryVersion), profile.tables);
    return { kind: profile.kind, tableCount: inventory.tables.length, unsupportedCount: inventory.unsupported_objects.length,
      inventory, inventoryRequest: buildInventoryRequest(inventory, profile.sourceCode), sourceRead: 'METADATA_ONLY' };
  }
  if (profile.kind === 'FILE_SCAN') {
    const files = [];
    async function walk(directory, depth = 0) {
      if (depth > 4) return;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (files.length >= 10000) fail('DISCOVERY_OBJECT_LIMIT');
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(full, depth + 1);
        else if (entry.isFile() && /\.(csv|xlsx|json|jsonl|parquet)$/iu.test(entry.name)) {
          files.push({ name: path.relative(profile.inboxRoot, full), bytes: (await stat(full)).size, format: path.extname(full).slice(1) });
        }
      }
    }
    await walk(profile.inboxRoot);
    return { kind: profile.kind, accessible: true, files, fileCount: files.length, sourceRead: 'FILE_METADATA_ONLY',
      note: '连接与交付规则预检通过；采集时逐文件执行解析与完整性检查' };
  }
  const config = validateConfig(await readJson(profile.config));
  config.timeout_seconds = Math.min(config.timeout_seconds, 15); config.retry.max_attempts = 1;
  const token = profile.environment?.[config.auth_env] ?? await tokenFromEnv(config, false);
  const response = await requestJson(buildInitialUrl(config, null), config, token);
  const payload = parseExactJson(response.body.toString('utf8'));
  if (config.success && valueAt(payload, config.success.path) !== config.success.equals) fail('API_BUSINESS_ERROR');
  const records = recordsFrom(payload, config);
  return { kind: profile.kind, firstPageRows: records.length, fields: records[0] && typeof records[0] === 'object' ? Object.keys(records[0]).slice(0, 1000) : [],
    sourceRead: 'BOUNDED_FIRST_PAGE', completeDelivery: false };
}
