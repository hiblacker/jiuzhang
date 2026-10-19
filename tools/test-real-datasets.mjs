import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const require=createRequire(new URL('../apps/web/package.json',import.meta.url))
const {chromium}=require('@playwright/test')
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split(/\r?\n/).filter(Boolean).map(line=>{const n=line.indexOf('=');return [line.slice(0,n),line.slice(n+1)]}))
const source=JSON.parse(readFileSync(new URL('../.local/source-test.json',import.meta.url),'utf8'))
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:1000}})
try{
 await page.goto('http://localhost:5175/login');await page.getByLabel('账号',{exact:true}).fill(env.JIUZHANG_BOOTSTRAP_USER);await page.getByLabel('密码',{exact:true}).fill(env.JIUZHANG_BOOTSTRAP_PASSWORD);await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL('**/overview')
 await page.goto('http://localhost:5175/datasets/new?sourceId='+source.id+'&objectId='+source.objectId)
 await page.getByLabel('数据集名称',{exact:true}).fill('browser_dataset_'+Date.now())
 await page.getByRole('tab',{name:'输出与入仓',exact:true}).click()
 await page.getByLabel('目标表',{exact:true}).fill('browser_'+Date.now())
 await page.getByRole('button',{name:'预览样本',exact:true}).click()
 await page.getByText('9007199254740993',{exact:true}).waitFor();await page.getByText('12345.6700',{exact:true}).waitFor()
 await page.getByRole('button',{name:'保存草稿',exact:true}).click();await page.waitForURL(/\/datasets\/\d+$/)
 await page.getByRole('button',{name:'发布版本',exact:true}).click()
 await page.getByRole('button',{name:'确认发布',exact:true}).click()
 await page.getByText('v1',{exact:true}).first().waitFor()
 await page.screenshot({path:'/tmp/jiuzhang-real-dataset-1280.png'})
 console.log('PASS real dataset browser 1280x1000: field type mapping, exact preview, save, publish')
}catch(error){console.log((await page.locator('body').innerText()).slice(0,7000));throw error}finally{await browser.close()}
