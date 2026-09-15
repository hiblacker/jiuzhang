import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../tools/lake-daily.mjs';

test('daily orchestrator requires an explicit valid window when supplied', () => {
  const parsed = parseArgs(['--window', '2026-09-15', '--allow-unverified-test-tls', '--require-api']);
  assert.equal(parsed.window, '2026-09-15');
  assert.equal(parsed.requireApi, true);
  assert.equal(parsed.allowUnverifiedTestTls, true);
  assert.throws(() => parseArgs(['--window', '2026-09-15', '--register']), /CONTROL_API_REQUIRED_FOR_REGISTER/);
  assert.equal(parseArgs(['--window', '2026-09-15', '--register', '--control-api', 'http://127.0.0.1:8080']).register, true);
  assert.throws(() => parseArgs(['--window', 'today']), /INVALID_WINDOW/);
});
