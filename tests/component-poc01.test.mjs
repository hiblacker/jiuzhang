import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { databaseName, sourceDatabaseName, directory } from '../poc/component/run.mjs';

test('POC-01 experiment database names are unique, bounded and separated', () => {
 const token = '20260914040542_abcdef12';
 assert.equal(databaseName(token), 'p01_20260914040542_abcdef12');
 assert.equal(sourceDatabaseName(token), 'src_20260914040542_abcdef12');
 assert.notEqual(databaseName(token), sourceDatabaseName(token));
 assert.throws(() => databaseName('20260914040542_ABCDEF12'), /Invalid experiment token/);
});

test('POC-01 creates token-scoped workflow names and HTTP retry task', async () => {
 const runner = await readFile(path.join(directory, 'run.mjs'), 'utf8');
 assert.match(runner, /poc01_\$\{token\}_daily/);
 assert.match(runner, /poc01_\$\{token\}_retry/);
 assert.match(runner, /taskType: 'HTTP'/);
 assert.match(runner, /url: 'http:\/\/adapter:8080\/retry-once'/);
 assert.match(runner, /failRetryTimes: 1/);
});

test('POC-01 preserves explicit Shanghai conversion at the landing boundary', async () => {
 const macro = await readFile(path.join(directory, 'dbt_project/macros/poc01_ops.sql'), 'utf8');
 const compose = await readFile(path.join(directory, 'compose.yaml'), 'utf8');
 assert.match(macro, /Asia\/Shanghai/);
 assert.match(compose, /TZ: Asia\/Shanghai/);
});

test('POC-01 remains an internal-only Compose stack', async () => {
 const compose = await readFile(path.join(directory, 'compose.yaml'), 'utf8');
 assert.match(compose, /internal: true/);
 assert.doesNotMatch(compose, /^\s*ports:/m);
 assert.match(compose, /mysql:8\.0\.43/);
 assert.match(compose, /postgres:16\.15/);
 assert.match(compose, /seatunnel:2\.3\.13/);
 assert.match(compose, /dolphinscheduler-standalone-server:3\.4\.3/);
});
