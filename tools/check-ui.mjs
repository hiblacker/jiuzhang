import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import assert from 'node:assert/strict'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const require=createRequire(path.join(root,'apps/web/package.json'))
const ts=require('typescript'), {parse,compileStyle}=require('@vue/compiler-sfc')
const src=path.join(root,'apps/web/src')
const controls=new Set(['button','input','select','textarea','table'])
const rawColor=/(#[a-f0-9]{3,8}\b|rgba?\(|hsla?\()/i
function inspect(text,file) {
  const errors=[]
  const scanScript=script=>{
    const tree=ts.createSourceFile(file+'.ts',script,ts.ScriptTarget.Latest,true)
    function walk(node) {
      if (ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&['h','createVNode','createElementVNode'].includes(node.expression.text)&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])&&controls.has(node.arguments[0].text)) errors.push('native control in render function')
      if(ts.isPropertyAssignment(node)&&ts.isStringLiteral(node.initializer)&&/color|background|border|fill|stroke/i.test(node.name.getText(tree))&&rawColor.test(node.initializer.text))errors.push('raw color in script')
      ts.forEachChild(node,walk)
    }
    walk(tree)
  }
  const scanStyle=style=>{
    const result=compileStyle({source:style,filename:file,id:'ui-check'})
    for(const error of result.errors)errors.push(String(error))
    result.rawResult?.root.walkDecls(declaration=>{if(rawColor.test(declaration.value))errors.push('raw style color: '+declaration.prop)})
  }
  if(file.endsWith('.vue')){
    const {descriptor,errors:parseErrors}=parse(text,{filename:file})
    errors.push(...parseErrors.map(String))
    function template(node) {
      if(node.type===1){
        if(controls.has(node.tag))errors.push('native control: '+node.tag)
        for(const prop of node.props){
          if(prop.type===6&&prop.name==='style'&&prop.value)scanStyle('x{'+prop.value.content+'}')
          if(prop.type===7&&prop.exp)scanScript(prop.exp.content)
        }
      }
      for(const child of node.children??[])template(child)
    }
    if(descriptor.template?.ast)template(descriptor.template.ast)
    for(const block of [descriptor.script,descriptor.scriptSetup])if(block)scanScript(block.content)
    for(const block of descriptor.styles)scanStyle(block.content)
  }else if(file.endsWith('.css'))scanStyle(text)
  else scanScript(text)
  return errors
}
assert.deepEqual(inspect('<template><nav><NButton>OK</NButton></nav></template>','allow.vue'),[])
assert(inspect('<template><button>Bad</button></template>','deny.vue').length)
assert(inspect('const v=h("input")','deny.ts').length)
assert(inspect('<template><div style="color:#fff" /></template>','deny.vue').length)
assert(inspect('<style scoped>.a{background:rgb(1,2,3)}</style>','deny.vue').length)
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{const file=path.join(dir,entry.name);return entry.isDirectory()?['mocks','__tests__','theme'].includes(entry.name)?[]:files(file):/[.](vue|ts|css)$/.test(file)?[file]:[]})}
const errors=files(src).flatMap(file=>inspect(fs.readFileSync(file,'utf8'),file).map(error=>path.relative(root,file)+': '+error))
if(errors.length){console.error(errors.join('\n'));process.exitCode=1}else console.log('UI AST controls, styles and negative fixtures passed.')
