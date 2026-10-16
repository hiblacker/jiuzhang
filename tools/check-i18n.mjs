import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import assert from 'node:assert/strict'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const require=createRequire(path.join(root,'apps/web/package.json'))
const ts=require('typescript'),{parse}=require('@vue/compiler-sfc')
const src=path.join(root,'apps/web/src'), errors=[], keys=new Set()
const dynamicFile=path.join(root,'tools/i18n-dynamic.json')
const dynamic=fs.existsSync(dynamicFile)?JSON.parse(fs.readFileSync(dynamicFile,'utf8')):{}
function dictionary(source,prefix='') {
  const tree=ts.createSourceFile('messages.ts',source,ts.ScriptTarget.Latest,true)
  function walkObject(object,base) {
    const seen=new Set()
    for(const prop of object.properties){
      if(!ts.isPropertyAssignment(prop))continue
      const name=ts.isIdentifier(prop.name)||ts.isStringLiteral(prop.name)?prop.name.text:prop.name.getText(tree)
      if(seen.has(name))throw new Error('Duplicate dictionary key: '+base+name)
      seen.add(name)
      if(ts.isObjectLiteralExpression(prop.initializer))walkObject(prop.initializer,base+name+'.')
      else if(ts.isStringLiteral(prop.initializer)){if(keys.has(base+name))throw new Error('Duplicate dictionary owner: '+base+name);keys.add(base+name)}
    }
  }
  function visit(node){if(ts.isExportAssignment(node)&&ts.isObjectLiteralExpression(node.expression))walkObject(node.expression,prefix);else ts.forEachChild(node,visit)}
  visit(tree)
}
const localeDirs = ['shared/i18n', ...fs.readdirSync(path.join(src, 'modules')).filter(name => fs.existsSync(path.join(src, 'modules', name, 'locales'))).map(name => 'modules/' + name + '/locales')]
for (const dir of localeDirs) {
  dictionary(fs.readFileSync(path.join(src, dir, 'zh-CN.ts'), 'utf8'))
  dictionary('export default ' + fs.readFileSync(path.join(src, dir, 'ui.zh-CN.json'), 'utf8'), 'ui.')
}
assert.throws(()=>dictionary('export default { duplicate: "one", duplicate: "two" }'))
const missing=key=>!keys.has(key)
assert(missing('__invalid_missing_key__'))
assert(!missing('save'))
assert.throws(()=>dictionary('export default { save: "duplicate owner" }'))
function scanScript(script,file){
  const tree=ts.createSourceFile(file+'.ts',script,ts.ScriptTarget.Latest,true)
  function visit(node){
    if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&['t','uiText'].includes(node.expression.text)&&node.arguments.length){
      const argument=node.arguments[0]
      if(ts.isStringLiteral(argument)){
        if(missing(argument.text))errors.push(file+': missing key '+argument.text)
      }else{
        const expression=argument.getText(tree).replace(/\s+/g,' ')
        const registration=dynamic[file]?.[expression]
        if(!registration?.length)errors.push(file+': unregistered dynamic key '+expression)
        else for(const key of registration)if(missing(key))errors.push(file+': missing registered key '+key)
      }
    }
    ts.forEachChild(node,visit)
  }
  visit(tree)
}
function scanVue(source,file){
  const {descriptor,errors:parseErrors}=parse(source,{filename:file})
  errors.push(...parseErrors.map(error=>file+': '+String(error)))
  for(const block of [descriptor.script,descriptor.scriptSetup])if(block)scanScript(block.content,file)
  function walk(node){
    if(node.type===2&&/[\u3400-\u9fff]/.test(node.content))errors.push(file+': untranslated template text '+node.content.trim().slice(0,40))
    if(node.type===5)scanScript('('+node.content.content+')',file)
    if(node.type===1)for(const prop of node.props){
      if(prop.type===6&&prop.value&&['title','label','description','placeholder','aria-label','tab'].includes(prop.name)&&/[\u3400-\u9fff]/.test(prop.value.content))errors.push(file+': untranslated attribute '+prop.name)
      if(prop.type===7&&prop.exp)scanScript('('+prop.exp.content+')',file)
    }
    for(const child of node.children??[])walk(child)
  }
  if(descriptor.template?.ast)walk(descriptor.template.ast)
}
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{const file=path.join(dir,entry.name);return entry.isDirectory()?['__tests__','mocks','i18n','locales'].includes(entry.name)?[]:files(file):/[.](ts|vue)$/.test(file)?[file]:[]})}
for(const file of files(src)){
  const name=path.relative(src,file).split(path.sep).join('/'),source=fs.readFileSync(file,'utf8')
  if(file.endsWith('.vue'))scanVue(source,name)
  else scanScript(source,name)
}
if(errors.length){console.error(errors.join('\n'));process.exitCode=1}
else console.log('Chinese message keys, explicit dynamic keys, duplicate/missing negative fixtures passed ('+keys.size+' keys).')
