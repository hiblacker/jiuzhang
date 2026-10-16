import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'apps/web/package.json'))
const ts = require('typescript')
const { parse } = require('@vue/compiler-sfc')
const src = path.join(root, 'apps/web/src')
const normalize = value => value.split(path.sep).join('/')
const violations = []
function report(file, message) { violations.push(normalize(path.relative(root, file)) + ': ' + message) }
export function imports(text, filename) {
  let blocks = [text]
  if (filename.endsWith('.vue')) {
    const { descriptor, errors } = parse(text, {filename})
    if (errors.length) throw new Error(filename + ': ' + errors.join('; '))
    blocks = [descriptor.script?.content, descriptor.scriptSetup?.content].filter(Boolean)
  }
  const found = []
  for (const block of blocks) {
    const tree = ts.createSourceFile(filename + '.ts', block, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text)
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (!node.arguments[0] || !ts.isStringLiteral(node.arguments[0])) throw new Error(filename + ': computed dynamic imports are prohibited')
        found.push(node.arguments[0].text)
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
  }
  return found
}
export function boundary(from, to) {
  const a = from.split('/'), b = to.split('/')
  if (a[0] === 'modules' && a[2] === 'locales' && !(b[0] === 'modules' && b[1] === a[1] && b[2] === 'locales')) return 'ARCH-03: locale entry cannot load domain runtime'
  if (to.includes('../') || ['apps','packages','modules'].includes(b[0]) && !to.startsWith('modules/')) return 'ARCH-06: frontend source cannot import another application'
  if (b[0] === 'mocks' && a[0] !== 'mocks' && !(from === 'main.ts' && to === 'mocks/browser.ts')) return 'ARCH-05: mocks only enter through main.ts'
  if (a[0] === 'shared' && ['app','pages','modules','mocks'].includes(b[0])) return 'ARCH-01: shared cannot import an upper layer'
  if (a[0] === 'modules' && ['app','pages','mocks'].includes(b[0])) return 'ARCH-01: modules cannot import composition layers'
  if (a[0] === 'pages' && (b[0] === 'app' || b[0] === 'pages' && a[1] !== b[1])) return 'ARCH-01: pages cannot depend on app or other pages'
  if (a[0] === 'mocks' && ['modules','pages','app'].includes(b[0])) return 'ARCH-05: mocks remain an independent adapter'
  if (b[0] === 'modules' && !(a[0] === 'modules' && a[1] === b[1])) {
    if (from === 'app/i18n.ts' && b.length === 4 && b[2] === 'locales' && b[3] === 'index.ts') return null
    if (b.length !== 3 || b[2] !== 'index.ts') return 'ARCH-03: domain consumers must use the public index'
    if (a[0] === 'modules') return 'ARCH-03: cross-domain composition belongs to pages'
  }
  return null
}
function files(dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : files(file)
    return /[.](ts|vue)$/.test(file) ? [file] : []
  })
}
function resolve(from, specifier) {
  const base = specifier.startsWith('@/') ? path.join(src, specifier.slice(2)) : path.resolve(path.dirname(from), specifier)
  return [base, base+'.ts', base+'.vue', path.join(base,'index.ts')].find(file => fs.existsSync(file) && fs.statSync(file).isFile())
}
function selftest() {
  assert.equal(boundary('shared/ui/a.ts','modules/jobs/index.ts')?.startsWith('ARCH-01'),true)
  assert.equal(boundary('modules/jobs/a.ts','modules/datasets/api/a.ts')?.startsWith('ARCH-03'),true)
  assert.equal(boundary('pages/jobs/a.vue','modules/jobs/index.ts'),null)
  assert.equal(boundary('app/i18n.ts','modules/jobs/locales/index.ts'),null)
  assert.equal(boundary('modules/jobs/locales/index.ts','modules/jobs/components/ScheduleForm.vue')?.startsWith('ARCH-03'),true)
  assert.equal(boundary('modules/jobs/locales/index.ts','modules/jobs/locales/zh-CN.ts'),null)
  assert.equal(boundary('app/i18n.ts','modules/jobs/locales/zh-CN.ts')?.startsWith('ARCH-03'),true)
  assert.equal(boundary('pages/jobs/a.vue','modules/jobs/locales/index.ts')?.startsWith('ARCH-03'),true)
  assert.equal(boundary('pages/jobs/a.vue','mocks/db/index.ts')?.startsWith('ARCH-05'),true)
  assert.equal(boundary('main.ts','mocks/browser.ts'),null)
  assert.deepEqual(imports('<script setup lang="ts">import x from "@/modules/jobs"; export {y} from "../private"; const z = () => import("./lazy.vue")</script><template><div /></template>', 'page.vue'), ['@/modules/jobs','../private','./lazy.vue'])
  assert.throws(() => imports('const x = import(path)', 'a.ts'))
}
selftest()
const graph = new Map()
for (const file of files(src)) {
  const name = normalize(path.relative(src,file)), dependencies = []
  for (const specifier of imports(fs.readFileSync(file,'utf8'), file)) {
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) continue
    if (specifier.includes('packages/contracts/openapi.yaml?raw') && name === 'mocks/handlers/core.ts') continue
    const target = resolve(file,specifier)
    if (!target) { report(file,'Unresolved local import: '+specifier); continue }
    if (!/[.](ts|vue)$/.test(target)) continue
    const next = normalize(path.relative(src,target))
    const error = boundary(name,next)
    if (error) report(file,error+' ('+specifier+' -> '+next+')')
    dependencies.push(next)
  }
  graph.set(name,dependencies)
}
const active = new Set(), done = new Set()
function visit(name, chain=[]) {
  if (active.has(name)) { violations.push('ARCH-04: cycle '+[...chain,name].join(' -> ')); return }
  if (done.has(name)) return
  active.add(name)
  for (const next of graph.get(name) ?? []) visit(next,[...chain,name])
  active.delete(name); done.add(name)
}
for (const name of graph.keys()) visit(name)
for (const file of files(path.join(root,'packages/contracts'))) {
  for (const specifier of imports(fs.readFileSync(file,'utf8'),file)) {
    if (specifier.includes('apps/') || specifier.includes('web/') || /^(vue|pinia|@jiuzhang\/web)$/.test(specifier)) report(file,'ARCH-06: contract cannot depend on host application')
  }
}
if (violations.length) { console.error(violations.join('\n')); process.exitCode=1 }
else console.log('Architecture boundaries and negative examples passed ('+graph.size+' source files).')
