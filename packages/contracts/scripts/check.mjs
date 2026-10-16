import SwaggerParser from '@apidevtools/swagger-parser'
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
await SwaggerParser.validate('openapi.yaml')
const dir = mkdtempSync(join(tmpdir(), 'jiuzhang-contracts-'))
try {
 execFileSync(process.execPath, ['node_modules/openapi-typescript/bin/cli.js', 'openapi.yaml', '-o', join(dir, 'schema.d.ts')], {stdio:'inherit'})
 if(readFileSync(join(dir,'schema.d.ts'),'utf8')!==readFileSync('generated/schema.d.ts','utf8')) throw new Error('生成类型已漂移，请执行 pnpm generate:api')
 console.log('OpenAPI validation and generation drift: passed')
} finally {rmSync(dir,{recursive:true,force:true})}
