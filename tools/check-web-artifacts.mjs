import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
function hasTestOnlyCode(text) { return ['jiuzhang-demo','mockServiceWorker','startMocking','Mock 场景','demo-db.invalid','零售订单库'].some(marker=>text.includes(marker)) }
assert.equal(hasTestOnlyCode('ordinary production bundle'),false)
assert.equal(hasTestOnlyCode('const db = "jiuzhang-demo"'),true)
function walk(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]) }
const files=walk(path.join(root,'apps/web/dist'))
assert(files.length>0,'frontend build output is missing')
const invalid=files.filter(file=>hasTestOnlyCode(path.basename(file))||hasTestOnlyCode(fs.readFileSync(file,'utf8')))
assert.deepEqual(invalid,[],'frontend build contains test-only data or startup code')
console.log('PASS frontend build excludes test-only data and startup code; negative fixture passed.')
