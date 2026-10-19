import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
const require=createRequire(new URL('../apps/web/package.json',import.meta.url));const {chromium}=require('@playwright/test')
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split(/\r?\n/).filter(Boolean).map(line=>{const n=line.indexOf('=');return [line.slice(0,n),line.slice(n+1)]}))
const browser=await chromium.launch()
const page=await browser.newPage({viewport:{width:1280,height:1000}})
const errors=[]
page.on('pageerror',e=>errors.push(e.message))
try {
 await page.goto('http://localhost:5175/login')
 await page.getByLabel('账号',{exact:true}).fill(env.JIUZHANG_BOOTSTRAP_USER)
 await page.getByLabel('密码',{exact:true}).fill(env.JIUZHANG_BOOTSTRAP_PASSWORD)
 await page.getByRole('button',{name:'登录',exact:true}).click()
 await page.waitForURL('**/overview')
 await page.getByText('近 7 日 · 真实运行记录 · 上海时区',{exact:true}).waitFor()
 if(await page.getByText('数据加载失败',{exact:true}).count())throw new Error('Overview unavailable')
 if(await page.getByText('演示数据',{exact:true}).count())throw new Error('Real overview labeled mock')
 await page.screenshot({path:'/tmp/jiuzhang-real-overview-1280.png',fullPage:true})
 const qualityResponse=await page.request.get('http://localhost:5175/api/v1/governance/quality')
 if(!qualityResponse.ok())throw new Error('Cannot load real quality rules')
 const quality=(await qualityResponse.json()).data[0]
 if(!quality)throw new Error('Run dataset acceptance before overview browser acceptance')
 await page.goto('http://localhost:5175/governance/quality/'+quality.id)
 await page.getByText('质量检查在数据集运行时执行，请发布绑定此规则的数据集后运行，在下方查看真实检查结果。',{exact:true}).waitFor()
 if(await page.getByRole('button',{name:/^(PASS|WARN|BLOCK)$/}).count())throw new Error('Real quality exposes Mock scenario buttons')
 await page.goto('http://localhost:5175/services')
 await page.getByText('此功能尚未接入真实服务',{exact:true}).waitFor()
 await page.getByRole('button',{name:'返回工作台',exact:true}).click()
 await page.waitForURL('**/overview')
 if(errors.length)throw new Error(errors.join(String.fromCharCode(10)))
console.log('PASS real browser 1280x1000: overview, real quality evaluation boundary, real labels, unavailable route guard')
}finally{await browser.close()}
