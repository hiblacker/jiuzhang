import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
function hasMock(text) { return ['jiuzhang-demo','mockServiceWorker','startMocking','Mock 场景','demo-db.invalid','零售订单库'].some(marker=>text.includes(marker)) }
assert.equal(hasMock('ordinary production bundle'),false)
assert.equal(hasMock('const db = "jiuzhang-demo"'),true)
function walk(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]) }
const files=walk(path.join(root,'apps/web/dist-real'))
assert(files.length>0,'real bundle is missing')
const invalid=files.filter(file=>hasMock(path.basename(file))||hasMock(fs.readFileSync(file,'utf8')))
assert.deepEqual(invalid,[],'real build contains mock code or seed data')
console.log('Real artifact excludes Mock seed, DB, controls and Service Worker; negative fixture passed.')
