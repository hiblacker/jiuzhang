import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
const require=createRequire(new URL('../apps/web/package.json',import.meta.url));const {chromium}=require('@playwright/test')
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split(/\r?\n/).filter(Boolean).map(line=>{const n=line.indexOf('=');return [line.slice(0,n),line.slice(n+1)]}))
const did=JSON.parse(readFileSync(new URL('../.local/dataset-test.json',import.meta.url),'utf8')).id
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message))
try{
 await page.goto('http://localhost:5175/login');await page.getByLabel('账号',{exact:true}).fill(env.JIUZHANG_BOOTSTRAP_USER);await page.getByLabel('密码',{exact:true}).fill(env.JIUZHANG_BOOTSTRAP_PASSWORD);await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL('**/overview')
 await page.goto('http://localhost:5175/datasets/'+did)
 if(await page.getByText('成功场景',{exact:true}).count())throw new Error('Real mode exposes fabricated outcomes')
 await page.getByRole('button',{name:'运行',exact:true}).click();await page.waitForURL(/\/runs\/\d+$/)
 await page.getByText('RUN_SUCCEEDED',{exact:false}).waitFor();await page.screenshot({path:'/tmp/jiuzhang-real-run-1280.png'})
 await page.goto('http://localhost:5175/warehouse/tables/'+did)
 await page.getByRole('tab',{name:'样本数据',exact:true}).click()
 await page.getByText('9007199254740993',{exact:true}).waitFor();await page.getByText('12345.6700',{exact:true}).waitFor()
 await page.goto('http://localhost:5175/warehouse/query?tableId='+did)
 await page.getByRole('button',{name:'运行查询',exact:true}).click();await page.waitForURL(/queryId=\d+/)
 await page.getByText('9007199254740993',{exact:true}).waitFor();await page.getByRole('button',{name:'导出 CSV',exact:true}).click();await page.waitForURL('**/warehouse/exports')
 await page.getByRole('button',{name:'下载',exact:true}).first().waitFor();await page.screenshot({path:'/tmp/jiuzhang-real-export-1280.png'})
 if(errors.length)throw new Error(errors.join('\n'))
 console.log('PASS real browser 1280x1000: actual run status/log, warehouse sample, query and CSV export; no fake outcomes')
}catch(e){console.log((await page.locator('body').innerText()).slice(0,5500));throw e}finally{await browser.close()}
