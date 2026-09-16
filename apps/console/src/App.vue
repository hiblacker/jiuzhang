<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { NAlert, NButton, NCard, NConfigProvider, NDataTable, NEmpty, NFormItem, NInput, NLayout, NLayoutSider, NMenu, NPagination, NSelect, NSpace, NTag, zhCN, dateZhCN } from 'naive-ui'
import { api, csrfToken, login, logout, type Identity, type Page, type Project } from './api'
const AssetCatalog=defineAsyncComponent(()=>import('./AssetCatalog.vue'))
const ModelWorkspace=defineAsyncComponent(()=>import('./ModelWorkspace.vue'))
const SystemManager=defineAsyncComponent(()=>import('./SystemManager.vue'))

const identity = ref<Identity|null>(null), ready = ref(false), busy = ref(false), error = ref('')
const username = ref(''), password = ref(''), invitation = ref(''), activate = ref(false)
const projectId = ref<number|null>(null), projects = ref<Project[]>([])
const page = ref('home'), search = ref(''), pageNumber = ref(1), total = ref(0)
const rows = ref<Record<string, unknown>[]>([])
const menu = [ ['home','工作台'],['systems','接入管理'],['assets','资产目录'],['models','数据开发'],['datasets','数据服务'],['runs','运行中心'],['settings','项目与设置'] ].map(([key,label]) => ({key,label}))
const heading = computed(() => menu.find(x=>x.key===page.value)?.label)
const role = computed(() => projects.value.find(p=>p.id===projectId.value)?.role)
const projectOptions = computed(() => projects.value.map(p=>({label:p.name,value:p.id})))
const columns = computed(() => [ {title:'名称',key:'name'}, ...(page.value==='runs' ? [{title:'业务日期',key:'business_date'},{title:'状态',key:'state'},{title:'原因',key:'error_code'}] : [{title:'编码',key:'code'},{title:'状态',key:'state'}]) ])
let generation = 0
async function identify() {
  identity.value = await api<Identity>('/warehouse/me')
  const result = await api<Page<Project>>('/warehouse/catalog/projects?limit=200')
  projects.value = result.items
  projectId.value = result.items[0]?.id ?? null
}
async function signIn() {
  busy.value=true;error.value=''
  try {
    if (activate.value) { await api('/auth/activate',{invitation:invitation.value,password:password.value});invitation.value='';activate.value=false }
    else { await login(username.value,password.value);await identify() }
  } catch(e) { error.value=e instanceof Error?e.message:'登录失败' }
  finally {password.value='';busy.value=false}
}
async function load() {
  const current=++generation
  rows.value=[];total.value=0;error.value=''
  if (!projectId.value || ['home','settings','systems','assets','models'].includes(page.value)) return
  busy.value=true
  try {
    const result=await api<Page<Record<string,unknown>>>(`/warehouse/catalog/projects/${projectId.value}/${page.value}?q=${encodeURIComponent(search.value)}&limit=25&offset=${(pageNumber.value-1)*25}`)
    if(current===generation){ rows.value=result.items;total.value=result.total }
  }catch(e){if(current===generation)error.value=e instanceof Error?e.message:'加载失败'}
  finally{if(current===generation)busy.value=false}
}
watch([page,projectId],()=>{pageNumber.value=1;search.value='';void load()})
watch(pageNumber,()=>void load())
window.addEventListener('session-expired',()=>{identity.value=null;rows.value=[]})
onMounted(async()=>{try{await csrfToken();await identify()}catch{}finally{ready.value=true}})
</script>

<template>
  <n-config-provider :locale="zhCN" :date-locale="dateZhCN">
    <main v-if="!identity" class="login-shell">
      <n-card class="login-card" title="九章数据平台">
        <p class="muted">统一接入 · 持续交付 · 可信数据</p>
        <n-alert v-if="error" type="error" class="gap">{{error}}</n-alert>
        <form @submit.prevent="signIn">
          <n-form-item v-if="!activate" label="账号"><n-input v-model:value="username" autocomplete="username" /></n-form-item>
          <n-form-item v-else label="开户或重置邀请码"><n-input v-model:value="invitation" type="password" autocomplete="off" /></n-form-item>
          <n-form-item :label="activate?'设置密码（至少 12 字符）':'密码'"><n-input v-model:value="password" type="password" :autocomplete="activate?'new-password':'current-password'" show-password-on="click" /></n-form-item>
          <n-button attr-type="submit" type="primary" block :loading="busy" :disabled="!ready">{{activate?'设置密码':'登录'}}</n-button>
          <n-button text class="gap" @click="activate=!activate;error=''">{{activate?'返回登录':'使用邀请码开户 / 重置密码'}}</n-button>
        </form>
      </n-card>
    </main>
    <n-layout v-else has-sider class="workspace">
      <n-layout-sider bordered :width="220" class="sidebar">
        <div class="brand">九章 <small>数据平台</small></div>
        <n-menu v-model:value="page" :options="menu" />
      </n-layout-sider>
      <n-layout content-style="padding: 28px 36px">
        <header><div><h1>{{heading}}</h1><span class="muted">{{identity.identity}} · {{identity.platformAdmin?'平台管理员':role}}</span></div>
          <n-space align="center"><n-select v-model:value="projectId" :options="projectOptions" placeholder="选择项目" style="width:220px" /><n-button @click="logout().then(()=>identity=null).catch(e=>error=e.message)">退出</n-button></n-space>
        </header>
        <n-alert v-if="error" type="error" class="gap">{{error}}</n-alert>
        <n-empty v-if="!projectId" description="尚未加入项目，请联系项目负责人" />
        <template v-else>
          <section v-if="page==='home'" class="cards">
            <n-card title="接入管理"><p>集中管理业务系统、连接与每日采集任务。</p><n-button @click="page='systems'">管理接入</n-button></n-card>
            <n-card title="数据服务"><p>查看已发布数据集与数据截止时间。</p><n-button @click="page='datasets'">查看数据集</n-button></n-card>
            <n-card title="运行中心"><p>检查交付记录，定位失败和缺交。</p><n-button @click="page='runs'">查看运行</n-button></n-card>
          </section>
          <SystemManager v-else-if="page==='systems'" :project="projectId" :can-manage="role==='OWNER'" :can-ingest="role==='OWNER'||role==='ENGINEER'"/>
          <AssetCatalog v-else-if="page==='assets'" :project="projectId"/>
          <ModelWorkspace v-else-if="page==='models'&&(role==='OWNER'||role==='ENGINEER')" :project="projectId" :can-manage="role==='OWNER'"/>
          <n-card v-else-if="['datasets','runs'].includes(page)">
            <n-space class="gap"><n-input v-model:value="search" placeholder="按名称搜索" @keyup.enter="pageNumber=1;load()" /><n-button @click="pageNumber=1;load()">搜索</n-button><n-tag>{{total}} 条</n-tag></n-space>
            <n-data-table :columns="columns" :data="rows" :loading="busy" :row-key="r=>String(r.id)" />
            <n-pagination v-model:page="pageNumber" :item-count="total" :page-size="25" class="gap" />
          </n-card>
          <n-card v-else><n-empty description="此模块正在接入新的产品流程" /></n-card>
        </template>
      </n-layout>
    </n-layout>
  </n-config-provider>
</template>
