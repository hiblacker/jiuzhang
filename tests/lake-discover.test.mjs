import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSchemas, schemaShape } from '../tools/lake-discover.mjs';

const table = { table: 'example', engine: 'InnoDB', primary_key: ['id'], estimated_rows: 3,
  columns: [{ column: 'id', position: 1, type: 'bigint unsigned', data_type: 'bigint', nullable: 'NO', key: 'PRI', extra: '' }] };

test('schema discovery blocks additions deletions and type/key changes but ignores row estimates', () => {
  const before = { tables: [table] };
  assert.deepEqual(compareSchemas(before, { tables: [{ ...table, estimated_rows: 999 }] }), { added: [], removed: [], changed: [] });
  assert.deepEqual(compareSchemas(before, { tables: [{ ...table, table: 'renamed' }] }), { added: ['renamed'], removed: ['example'], changed: [] });
  assert.deepEqual(compareSchemas(before, { tables: [{ ...table, columns: [{ ...table.columns[0], type: 'varchar(40)', data_type: 'varchar' }] }] }).changed, ['example']);
  assert.deepEqual(compareSchemas(before, { tables: [{ ...table, primary_key: [] }] }).changed, ['example']);
  assert.equal(schemaShape(before)[0].columns[0].type, 'bigint unsigned');
});
