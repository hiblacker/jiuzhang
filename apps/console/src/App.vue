<script setup lang="ts">
import { computed,defineAsyncComponent,h,onMounted,ref,watch } from 'vue'
import { NAlert,NButton,NCard,NConfigProvider,NDataTable,NEmpty,NFormItem,NInput,NLayout,NLayoutSider,NMenu,NModal,NPagination,NSpace,zhCN,dateZhCN } from 'naive-ui'
import { api,ApiError,csrfToken,login,logout,type Identity,type Page,type Project } from './api'
const HomeDashboard=defineAsyncComponent(()=>import('./HomeDashboard.vue'))
const SystemManager=defineAsyncComponent(()=>import('./SystemManager.vue'))
const AssetCatalog=defineAsyncComponent(()=>import('./AssetCatalog.vue'))
const ModelWorkspace=defineAsyncComponent(()=>import('./ModelWorkspace.vue'))
const DatasetService=defineAsyncComponent(()=>import('./DatasetService.vue'))
const RunCenter=defineAsyncComponent(()=>import('./RunCenter.vue'))
const ProjectSettings=defineAsyncComponent(()=>import('./ProjectSettings.vue'))
const identity=ref<Identity|null>(null),ready=ref(false),busy=ref(false),error=ref('')
const username=ref(''),password=ref(''),invitation=ref(''),activate=ref(false),page=ref('home')
const projects=ref<Project[]>([]),selectedProject=ref<Project|null>(null),projectId=computed(()=>selectedProject.value?.id||null),role=computed(()=>selectedProject.value?.role)
const projectSearch=ref(''),projectPage=ref(1),projectTotal=ref(0),projectModal=ref(false)
const menu=computed(()=>[['home','工作台'],['systems','接入管理'],['assets','资产目录'],...(role.value==='OWNER'||role.value==='ENGINEER'?[['models','数据开发']]:[]),['datasets','数据服务'],['runs','运行中心'],['settings','项目与设置']].map(([key,label])=>({key,label})))
const heading=computed(()=>menu.value.find(m=>m.key===page.value)?.label)
const projectColumns=[{title:'项目',key:'name'},{title:'编码',key:'code'},{title:'角色',key:'role'},{title:'操作',key:'actions',render:(p:Project)=>h(NButton,{text:true,onClick:()=>{selectedProject.value=p;projectModal.value=false}},()=> '进入项目')}]
let projectGeneration=0
async function loadProjects(){const current=++projectGeneration;const result=await api<Page<Project>>(`/warehouse/catalog/projects?q=${encodeURIComponent(projectSearch.value)}&limit=25&offset=${(projectPage.value-1)*25}`);if(current===projectGeneration){projects.value=result.items;projectTotal.value=result.total;if(!selectedProject.value)selectedProject.value=result.items[0]||null}}
async function identify(){identity.value=await api<Identity>('/warehouse/me');await loadProjects();if(selectedProject.value){const current=identity.value.projects.find(p=>p.id===selectedProject.value?.id);if(current)selectedProject.value=current}}
const INVITATION_LENGTH=43,MIN_PASSWORD_CHARS=12,MAX_PASSWORD_BYTES=72
// Mirrors the control API pre-checks so a malformed paste or short password is
// named before any request is sent; the server keeps the authoritative check.
function activationProblem(invitation:string,password:string){
  const code=invitation.trim()
  if(code.length!==INVITATION_LENGTH)return `邀请码应为 ${INVITATION_LENGTH} 位，当前 ${code.length} 位。请只复制邀请文件里 invitation 的值，不要带引号、花括号或换行。`
  if(!password)return '请输入要设置的密码。'
  if(password.length<MIN_PASSWORD_CHARS)return `密码至少 ${MIN_PASSWORD_CHARS} 个字符，当前 ${password.length} 个。`
  const bytes=new TextEncoder().encode(password).length
  return bytes>MAX_PASSWORD_BYTES?`密码不能超过 ${MAX_PASSWORD_BYTES} 字节，当前 ${bytes} 字节（一个汉字按 3 字节计）。`:''
}
async function signIn(){if(activate.value){const problem=activationProblem(invitation.value,password.value);if(problem){error.value=problem;return}}busy.value=true;error.value='';try{if(activate.value){await api('/auth/activate',{invitation:invitation.value.trim(),password:password.value});invitation.value='';activate.value=false}else{await login(username.value,password.value);selectedProject.value=null;projectPage.value=1;projectSearch.value='';page.value='home';await identify()}}catch(e){error.value=(e as Error).message}finally{password.value='';busy.value=false}}
async function signOut(){try{await logout();identity.value=null;selectedProject.value=null;projects.value=[];projectModal.value=false;page.value='home'}catch(e){error.value=(e as Error).message}}
async function searchProjects(){try{await loadProjects()}catch(e){error.value=(e as Error).message}}
watch(projectPage,()=>void searchProjects());watch(menu,items=>{if(!items.some(m=>m.key===page.value))page.value='home'})
window.addEventListener('session-expired',()=>{identity.value=null;selectedProject.value=null;projects.value=[]})
onMounted(async()=>{try{await csrfToken();await identify()}catch(e){if(!(e instanceof ApiError&&e.status===401))error.value=(e as Error).message}finally{ready.value=true}})
</script>

<template>
  <n-config-provider :locale="zhCN" :date-locale="dateZhCN">
    <main v-if="!identity" class="login-shell">
      <n-card class="login-card" title="九章数据平台">
        <p class="muted">统一接入 · 持续交付 · 可信数据</p>
        <n-alert v-if="error" type="error" class="gap">{{error}}</n-alert>
        <form @submit.prevent="signIn">
          <n-form-item v-if="!activate" label="账号"><n-input v-model:value="username" :input-props="{'aria-label':'账号'}" autocomplete="username" /></n-form-item>
          <n-form-item v-else label="开户或重置邀请码"><n-input v-model:value="invitation" :input-props="{'aria-label':'邀请码'}" type="password" autocomplete="off" /></n-form-item>
          <n-form-item :label="activate?'设置密码（至少 12 字符）':'密码'"><n-input v-model:value="password" :input-props="{'aria-label':'密码'}" type="password" :autocomplete="activate?'new-password':'current-password'" show-password-on="click" /></n-form-item>
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
          <n-space align="center"><n-button @click="projectModal=true;searchProjects()">{{selectedProject?.name||'选择项目'}}</n-button><n-button @click="signOut">退出</n-button></n-space>
        </header>
        <n-alert v-if="error" type="error" class="gap">{{error}}</n-alert>
        <ProjectSettings v-if="page==='settings'||(!projectId&&identity.platformAdmin)" :project="projectId" :can-manage="role==='OWNER'" :admin="identity.platformAdmin" :identity="identity.identity" @projects-changed="identify().catch(e=>error=e.message)"/>
        <n-empty v-else-if="!projectId" description="尚未加入项目，请联系项目负责人" />
        <template v-else>
          <HomeDashboard v-if="page==='home'" :project="projectId" @navigate="page=$event"/>
          <SystemManager v-else-if="page==='systems'" :project="projectId" :can-manage="role==='OWNER'" :can-ingest="role==='OWNER'||role==='ENGINEER'"/>
          <AssetCatalog v-else-if="page==='assets'" :project="projectId"/>
          <ModelWorkspace v-else-if="page==='models'&&(role==='OWNER'||role==='ENGINEER')" :project="projectId" :can-manage="role==='OWNER'"/>
          <DatasetService v-else-if="page==='datasets'" :project="projectId" :can-manage="role==='OWNER'"/>
          <RunCenter v-else-if="page==='runs'" :project="projectId" :can-manage="role==='OWNER'" :can-operate="role==='OWNER'||role==='ENGINEER'" :identity="identity.identity"/>
        </template>
      </n-layout>
    </n-layout>
    <n-modal v-model:show="projectModal" preset="card" title="选择项目" style="width:min(820px,96vw)"><n-space class="gap"><n-input v-model:value="projectSearch" placeholder="按项目名称或编码搜索" @keyup.enter="projectPage=1;searchProjects()"/><n-button @click="projectPage=1;searchProjects()">搜索</n-button></n-space><n-data-table :columns="projectColumns" :data="projects"/><n-pagination v-model:page="projectPage" :item-count="projectTotal" :page-size="25" class="gap"/></n-modal>
  </n-config-provider>
</template>
