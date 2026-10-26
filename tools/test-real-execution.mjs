import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
const require=createRequire(new URL('../apps/web/package.json',import.meta.url));const {chromium,expect}=require('@playwright/test')
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split(/\r?\n/).filter(Boolean).map(line=>{const n=line.indexOf('=');return [line.slice(0,n),line.slice(n+1)]}))
const did=JSON.parse(readFileSync(new URL('../.local/dataset-test.json',import.meta.url),'utf8')).id
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message))
try{
 await page.goto('http://localhost:5175/login');await page.getByLabel('账号',{exact:true}).fill(env.JIUZHANG_BOOTSTRAP_USER);await page.getByLabel('密码',{exact:true}).fill(env.JIUZHANG_BOOTSTRAP_PASSWORD);await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL('**/overview')
 await page.goto('http://localhost:5175/datasets/'+did)
 const datasetResponse=await page.request.get('http://localhost:5175/api/v1/datasets/'+did)
 expect(datasetResponse.ok()).toBe(true)
 const dataset=(await datasetResponse.json()).data
 if(await page.getByText('成功场景',{exact:true}).count())throw new Error('Real mode exposes fabricated outcomes')
 await page.getByRole('button',{name:'运行',exact:true}).click();await page.waitForURL(/\/runs\/\d+$/)
 await page.getByText('RUN_SUCCEEDED',{exact:false}).waitFor();await page.screenshot({path:'/tmp/jiuzhang-real-run-1280.png'})
 const rid=new URL(page.url()).pathname.split('/').at(-1)
 const datasetLink=page.getByRole('button',{name:dataset.name,exact:true})
 await expect(datasetLink).toBeVisible()
 await datasetLink.click();await page.waitForURL('**/datasets/'+did)
 await page.getByRole('tab',{name:'运行',exact:true}).click()
 const history=page.getByRole('region',{name:'运行历史',exact:true})
 await expect(history.getByText(dataset.name,{exact:true}).first()).toBeVisible()
 await page.goto('http://localhost:5175/runs')
 const runRow=page.locator('.n-data-table-tr').filter({has:page.getByRole('button',{name:rid,exact:true})})
 await expect(runRow.getByRole('button',{name:dataset.name,exact:true})).toBeVisible()
 await page.screenshot({path:'/tmp/jiuzhang-run-dataset-names-1280.png'})
 await runRow.getByRole('button',{name:dataset.name,exact:true}).click()
 await page.waitForURL('**/datasets/'+did)
 const taskResponse=await page.request.get('http://localhost:5175/api/v1/tasks/'+did)
 if(taskResponse.ok()){
  await page.goto('http://localhost:5175/tasks/'+did)
  await expect(page.getByRole('region',{name:'运行历史',exact:true}).getByText(dataset.name,{exact:true}).first()).toBeVisible()
 }
 await page.goto('http://localhost:5175/warehouse/tables/'+did)
 await page.getByRole('tab',{name:'样本数据',exact:true}).click()
 await page.getByText('9007199254740993',{exact:true}).waitFor();await page.getByText('12345.6700',{exact:true}).waitFor()
 await page.goto('http://localhost:5175/warehouse/query?tableId='+did)
 await page.getByRole('button',{name:'运行查询',exact:true}).click();await page.waitForURL(/queryId=\d+/)
 await page.getByText('9007199254740993',{exact:true}).waitFor();await page.getByRole('button',{name:'导出 CSV',exact:true}).click();await page.waitForURL('**/warehouse/exports')
 await page.getByRole('button',{name:'下载',exact:true}).first().waitFor();await page.screenshot({path:'/tmp/jiuzhang-real-export-1280.png'})
 if(errors.length)throw new Error(errors.join('\n'))
 console.log('PASS real browser 1280x1000: dataset names and navigation in run list/detail/history, actual execution, warehouse sample, query and CSV export')
}catch(e){console.log((await page.locator('body').innerText()).slice(0,5500));throw e}finally{await browser.close()}
