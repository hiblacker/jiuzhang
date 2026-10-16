import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const cwd=path.join(root,'apps/web')
const require=createRequire(path.join(cwd,'package.json'))
const {ESLint}=require('eslint')
const eslint=new ESLint({cwd})
const filePath=path.join(cwd,'src/pages/system/StatusPage.vue')
const cases=[
  ['window.localStorage.getItem("token")','no-restricted-syntax'],
  ['globalThis["indexedDB"].open("data")','no-restricted-syntax'],
  ['void fetch("/api/v1/sources")','no-restricted-globals'],
  ['const value: any = 1; void value','@typescript-eslint/no-explicit-any'],
  ['Promise.resolve(1)','@typescript-eslint/no-floating-promises'],
  ['const value = true ? (false ? 1 : 2) : 3; void value','no-nested-ternary'],
]
for(const [code,rule] of cases){
  const [result]=await eslint.lintText('<script setup lang="ts">'+code+'</script><template><div /></template>',{filePath})
  assert(result.messages.some(message=>message.ruleId===rule),rule+' did not reject: '+code+' '+JSON.stringify(result.messages))
}
const [valid]=await eslint.lintText('<script setup lang="ts">import {ref} from "vue"; const value=ref(1)</script><template><div>{{value}}</div></template>',{filePath})
assert.equal(valid.errorCount,0,JSON.stringify(valid.messages))
console.log('Lint allowed example and transport/storage/type/promise/complexity rejection examples passed.')
