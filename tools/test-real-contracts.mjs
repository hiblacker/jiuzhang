import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { request } = require('@playwright/test')
const Ajv = require('ajv/dist/2020.js').default
const addFormats = require('ajv-formats')
const schema = JSON.parse(readFileSync(new URL('../packages/contracts/openapi.yaml', import.meta.url), 'utf8'))
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').trim().split(/\r?\n/).map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)] }))
const ajv = new Ajv({ strict: false, allErrors: true })
addFormats(ajv)
const api = await request.newContext({ baseURL: process.env.JIUZHANG_TEST_API || 'http://127.0.0.1:8080/api/v1/' })
let csrf = '', checked = 0
async function call(method, template, path = template, body, expected = 200) {
 const operation = schema.paths[template][method.toLowerCase()]
 const headers = { 'X-CSRF-Token': csrf, 'Idempotency-Key': crypto.randomUUID() }
 const response = await api.fetch('.' + path, { method, data: body, headers })
 const data = await response.json()
 if (response.status() !== expected) throw new Error(method + ' ' + path + ': ' + response.status() + ' ' + data.error?.code)
 const responseSchema = operation.responses[String(expected)]?.content?.['application/json']?.schema
 if (!responseSchema) throw new Error('Undeclared response ' + template)
 const validate = ajv.compile({ ...responseSchema, components: schema.components })
 if (!validate(data)) throw new Error(method + ' ' + path + ': ' + JSON.stringify(validate.errors))
 checked++
 if (template === '/auth/login') csrf = data.data.csrfToken
 return data.data
}
try {
 await call('GET', '/session', '/session', undefined, 401)
 await call('POST', '/auth/login', '/auth/login', { username: env.JIUZHANG_BOOTSTRAP_USER, password: env.JIUZHANG_BOOTSTRAP_PASSWORD })
 await call('GET', '/session')
 for (const path of ['/overview','/sources','/datasets','/runs','/warehouse/tables','/warehouse/metrics','/warehouse/subject-domains','/queries','/exports','/governance/quality','/governance/masking','/system/users','/system/audit','/system/roles','/system/settings']) await call('GET', path)
 const source = JSON.parse(readFileSync(new URL('../.local/source-test.json', import.meta.url), 'utf8'))
 const dataset = JSON.parse(readFileSync(new URL('../.local/dataset-test.json', import.meta.url), 'utf8'))
 await call('GET','/sources/{id}','/sources/'+source.id)
 await call('GET','/sources/{id}/objects','/sources/'+source.id+'/objects')
 await call('GET','/sources/{id}/objects/{objectId}/fields','/sources/'+source.id+'/objects/'+source.objectId+'/fields')
 await call('POST','/sources/{id}/preview','/sources/'+source.id+'/preview',{objectId:source.objectId})
 await call('GET','/datasets/{id}','/datasets/'+dataset.id)
 await call('GET','/datasets/{id}/versions','/datasets/'+dataset.id+'/versions')
 await call('GET','/datasets/{id}/versions/{version}','/datasets/'+dataset.id+'/versions/1')
 await call('POST','/datasets/{id}/validate','/datasets/'+dataset.id+'/validate')
 await call('POST','/datasets/{id}/preview','/datasets/'+dataset.id+'/preview')
 const run=JSON.parse(readFileSync(new URL('../.local/run-test.json',import.meta.url),'utf8'))
 await call('GET','/runs/{id}','/runs/'+run.id)
 const table=await call('GET','/warehouse/tables/{id}','/warehouse/tables/'+dataset.id)
 const query=await call('POST','/queries','/queries',{sql:'SELECT * FROM '+table.name+' LIMIT 1'},201)
 await call('GET','/queries/{id}','/queries/'+query.id)
 const exp=await call('POST','/exports','/exports',{queryId:query.id,format:'csv'},201)
 await call('GET','/exports/{id}','/exports/'+exp.id)
 await call('POST','/queries','/queries',{sql:'DELETE FROM '+table.name},422)
 console.log('PASS real OpenAPI response validation: '+checked+' responses; exact schemas, nulls, precision strings and error envelopes')
}finally { await api.dispose() }
