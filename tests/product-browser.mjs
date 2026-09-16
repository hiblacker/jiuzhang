// Opt-in, real same-origin browser and worker acceptance. All source data is synthetic.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '../apps/console/node_modules/playwright/index.mjs';
import {runOnce,validateRegistry} from '../apps/ingestion-worker/lake-runtime.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=process.env.MODEL_TEST_API,admin=process.env.MODEL_TEST_ADMIN,worker=process.env.CONTROL_API_WORKER_TOKEN;
assert.ok(/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(base||'')&&admin&&worker&&process.env.LAKE_REVIEW_DBT_PYTHON,'Isolated integration environment required');
const id='ui_'+randomUUID().replaceAll('-',''),root=path.join(repo,'work/product-review/browser',id),errors=[];
await mkdir(root,{recursive:true,mode:0o700});
async function api(route,body){const response=await fetch(base+'/api/v1/'+route,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${admin}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();assert.ok(response.ok,`${route}: ${value.code||response.status}`);return value;}
async function eventually(check){const until=Date.now()+15000;do{const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,150));}while(Date.now()<until);throw new Error('Expected state did not arrive');}
const project=await api('warehouse/projects',{code:id,name:'浏览器合成验收'}),owner=id+'_owner',password='Synthetic-'+randomUUID();
const invitation=await api('warehouse/accounts/invite',{identity:owner,displayName:'合成负责人',projectId:project.id,role:'OWNER'});
await api('warehouse/environments',{code:id,name:'合成执行环境',workerIds:[id],maxParallel:2});
const resource=await api('warehouse/resources',{code:id,name:'合成文件资源',kind:'FILE_SCAN',environment:id,resourceGroup:id,maxBytes:1048576,maxParallel:1,requestsPerSecond:5});
await api(`warehouse/resources/${resource.id}/grant`,{projectId:project.id});
await api('warehouse/model-repositories',{code:id,name:'合成模型仓库',workerIds:[id],projectPaths:['models/commerce']});
await api(`warehouse/model-repositories/${id}/grant`,{projectId:project.id});
const inbox=path.join(root,'inbox');await mkdir(inbox);await writeFile(path.join(inbox,'orders.csv'),'id,team,amount\n001,east,12345678901234567.89\n002,west,8.20\n');await writeFile(path.join(inbox,'orders.csv.done'),'');
const registry=validateRegistry({version:2,environment:id,lakeRoot:path.join(root,'lake'),resources:{[id]:{kind:'FILE_SCAN',resourceGroup:id,inboxRoot:inbox,parserPython:process.env.LAKE_PYTHON}}});
const dbUrl=new URL(process.env.LAKE_REVIEW_JDBC_URL.replace(/^jdbc:/,''));
const modelRegistry={version:2,lakeRoot:registry.lakeRoot,workRoot:path.join(root,'model-work'),packageRoot:path.join(root,'model-packages'),database:{host:'127.0.0.1',port:Number(dbUrl.port),dbname:'lake_review',user:'bydw_model_worker_login',passwordEnv:'MODEL_DATABASE_PASSWORD'},profiles:{},repositories:{[id]:{repository:repo,projectPaths:['models/commerce'],projectIds:[project.id]}}};
await writeFile(path.join(root,'model-runtime.json'),JSON.stringify(modelRegistry),{mode:0o600});
async function modelOnce(){const child=spawn(process.env.LAKE_REVIEW_DBT_PYTHON,[path.join(repo,'apps/model-worker/worker.py'),'--registry',path.join(root,'model-runtime.json'),'--api',base,'--instance',id,'--once'],{cwd:repo,env:{...process.env,MODEL_DATABASE_PASSWORD:process.env.LAKE_REVIEW_MODEL_PASSWORD}});let log='';for(const pipe of [child.stdout,child.stderr])pipe.on('data',chunk=>log+=chunk);const code=await new Promise(resolve=>child.on('close',resolve));await writeFile(path.join(root,'model-worker.log'),log,{mode:0o600});assert.equal(code,0,'Model worker: inspect private log');}
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage();
page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
const button=(name,scope=page)=>scope.getByRole('button',{name,exact:true});
const modal=()=>page.locator('.n-modal:visible').last();
const item=(label,scope=page)=>scope.locator('.n-form-item').filter({has:page.locator('.n-form-item-label').filter({hasText:new RegExp('^'+label+'$')})});
const fill=(label,value,scope=modal())=>item(label,scope).locator('input,textarea').fill(value);
async function select(label,text,scope=modal()){await item(label,scope).locator('.n-base-selection').click();await page.locator('.n-base-select-option:visible').filter({hasText:text}).click();}
async function menu(name){await page.getByRole('menuitem',{name,exact:true}).click();}
async function activate(code){await button('使用邀请码开户 / 重置密码').click();await page.getByLabel('邀请码',{exact:true}).fill(code);await page.getByLabel('密码',{exact:true}).fill(password);await button('设置密码').click();await page.getByLabel('账号',{exact:true}).waitFor();}
async function login(identity){await page.getByLabel('账号',{exact:true}).fill(identity);await page.getByLabel('密码',{exact:true}).fill(password);await button('登录').click();await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();}
try{
  await page.goto(base);await activate(invitation.invitation);await login(owner);
  await menu('接入管理');await button('登记业务系统').click();await fill('稳定编码',id);await fill('系统名称','合成订单系统');await fill('业务责任人','合成业务负责人');await fill('技术责任人','合成技术负责人');await button('保存',modal()).click();
  await button('新增实例').click();await fill('实例编码','test');await fill('实例名称','合成测试实例');await button('保存',modal()).click();
  await button('接入新来源').click();await select('已授权执行资源','合成文件资源');await fill('连接编码','files');await fill('连接名称','每日订单目录');await fill('来源稳定编码',id+'_orders');await fill('采集通道名称','每日订单');await modal().getByRole('checkbox',{name:'每日子目录（YYYY-MM-DD）'}).uncheck();await fill('每日必需文件（每行一个相对文件名）','orders.csv');
  await button('保存并测试发现').click();await button('重新测试').waitFor();
  assert.equal((await runOnce({controlApi:base,token:worker,instance:id},registry)).state,'COMPLETE');
  await button('设置交付计划').click();await fill('每日执行时间','23:59');await button('确认范围并启用').click();
  await button('采集今日').click();assert.equal((await eventually(async()=>{const r=await runOnce({controlApi:base,token:worker,instance:id},registry);return r.state==='IDLE'?null:r})).state,'COMPLETE');
  await menu('资产目录');await page.getByText('orders.csv',{exact:true}).first().waitFor();await page.screenshot({path:path.join(root,'assets.png'),fullPage:true});
  await menu('数据开发');await button('从 Git 模型包建立数据集').click();await button('提交打包任务').click();
  await eventually(async()=>((await api(`warehouse/projects/${project.id}/model-packages`)).items.length>0));await modelOnce();await button('刷新包列表').click();await button('绑定资产建立模型').click();
  await fill('数据集编码','orders');await fill('数据集名称','订单明细');await button('选择来源对象').click();await button('选择',modal()).first().click();await button('保存模型版本').click();
  const buildButton=button('使用固定输入构建');await buildButton.waitFor();
  if(await buildButton.isDisabled()){await button('选择资产版本').click();await button('选择',modal()).first().click();}
  await buildButton.click();await button('质量与依赖').first().waitFor();await modelOnce();await button('刷新状态').click();await button('发布').click();await fill('发布原因','合成浏览器验收首发');await button('确认发布').click();await eventually(async()=>((await api(`warehouse/catalog/projects/${project.id}/datasets`)).items[0]?.active_release_id));
  await page.screenshot({path:path.join(root,'model.png'),fullPage:true});
  const dataset=(await api(`warehouse/catalog/projects/${project.id}/datasets`)).items[0];
  // Invite through the UI. The one-time secret is read in memory, never included in an artifact.
  await menu('项目与设置');await fill('账号',id+'_viewer',page);await fill('显示名称','合成查看者',page);await button('邀请新账号').click();await modal().locator('input[type=password]').waitFor();const viewerInvite=await modal().locator('input[type=password]').inputValue();await modal().locator('.n-base-close').click();
  await menu('数据服务');await button('订单明细').click();await button('配置行列授权').click();await select('项目查看者 / 服务身份',id+'_viewer');await select('允许查询字段','order_id');await page.keyboard.press('Escape');await select('允许查询字段','amount');await page.keyboard.press('Escape');await button('增加行条件').click();await modal().locator('.n-base-selection').last().click();await page.locator('.n-base-select-option:visible').filter({hasText:'team'}).click();await modal().getByPlaceholder('字段等于此值').fill('east');await button('保存授权新版本').click();
  await button('查询').click();await page.getByText('12345678901234567.89',{exact:true}).first().waitFor();
  await button('退出').click();await activate(viewerInvite);await login(id+'_viewer');assert.equal(await page.getByRole('menuitem',{name:'数据开发',exact:true}).count(),0);
  await menu('数据服务');await button('订单明细').click();await button('查询').click();await page.getByText('12345678901234567.89',{exact:true}).first().waitFor();assert.equal(await page.getByText('8.20',{exact:true}).count(),0);
  const downloadEvent=page.waitForEvent('download');await button('导出本页 CSV').click();const download=await downloadEvent;await download.saveAs(path.join(root,'viewer.csv'));const csv=await readFile(path.join(root,'viewer.csv'),'utf8');assert.ok(csv.includes('12345678901234567.89')&&!csv.includes('8.20')&&!csv.includes('team'));
  await page.screenshot({path:path.join(root,'viewer.png'),fullPage:true});
  const forbidden=await page.evaluate(async()=>{const r=await fetch('/api/v1/warehouse/catalog/projects/9223372036854775806/assets');return r.status});assert.equal(forbidden,403);
  assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
  await api(`warehouse/accounts/${id}_viewer/revoke-sessions`,{});await page.reload();await button('登录').waitFor();
  assert.deepEqual(errors,[]);await writeFile(path.join(root,'evidence.json'),JSON.stringify({state:'PASS',projectId:project.id,datasetId:dataset.id,releaseId:dataset.active_release_id,checks:['invite/login/logout/revocation','system/instance/dynamic folder onboarding','file worker and asset catalog','Git package/asset binding/dbt/build/publish','UI invitation and row/column policy','viewer precise query/export/project isolation','no browser persistent secrets','no page errors']},null,2));
  console.log(JSON.stringify({state:'PASS',evidenceDirectory:path.relative(repo,root)}));
}catch(error){await page.screenshot({path:path.join(root,'failure.png'),fullPage:true}).catch(()=>{});throw error;}finally{await context.close();await browser.close();}
