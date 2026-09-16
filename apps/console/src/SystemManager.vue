<script setup lang="ts">
import { defineAsyncComponent, h, onMounted, reactive, ref, watch } from 'vue'
import { NAlert,NButton,NCard,NDataTable,NDescriptions,NDescriptionsItem,NFormItem,NInput,NModal,NPagination,NSelect,NSpace,NTag, type DataTableColumns } from 'naive-ui'
import { api,type Page } from './api'
const props=defineProps<{project:number;canManage:boolean;canIngest:boolean}>()
const IngestionManager=defineAsyncComponent(()=>import('./IngestionManager.vue'))
interface System {id:number;code:string;name:string;domain:string;organization:string;business_owner:string;technical_owner:string;description:string;lifecycle:string;revision:number;instance_count:number}
interface Instance {id:number;code:string;name:string;environment:string;purpose:string;lifecycle:string}
const rows=ref<System[]>([]),selected=ref<System|null>(null),instances=ref<Instance[]>([])
const q=ref(''),environment=ref(''),lifecycle=ref(''),page=ref(1),total=ref(0),busy=ref(false),error=ref(''),modal=ref(false),instanceModal=ref(false)
const form=reactive({code:'',name:'',domain:'',organization:'',businessOwner:'',technicalOwner:'',description:'',expectedVersion:0})
const instanceForm=reactive({code:'',name:'',environment:'TEST',purpose:''})
const editing=ref(false)
const lifecycleNames:Record<string,string>={DRAFT:'草稿',ONBOARDING:'接入中',ACTIVE:'启用',PAUSED:'暂停',RETIRED:'退役'}
const environmentOptions=[{label:'测试',value:'TEST'},{label:'生产',value:'PRODUCTION'},{label:'开发',value:'DEVELOPMENT'}]
const columns:DataTableColumns<System>=[
  {title:'业务系统',key:'name',render:row=>h(NButton,{text:true,type:'primary',onClick:()=>detail(row)},()=>row.name)},
  {title:'编码',key:'code'},{title:'组织',key:'organization'},{title:'技术责任人',key:'technical_owner'},
  {title:'状态',key:'lifecycle',render:row=>h(NTag,{},()=>lifecycleNames[row.lifecycle]||row.lifecycle)},{title:'可见实例',key:'instance_count'},
]
const instanceColumns:DataTableColumns<Instance>=[{title:'实例',key:'name'},{title:'编码',key:'code'},{title:'环境',key:'environment'},{title:'用途',key:'purpose'}]
let generation=0
async function load(){const current=++generation;busy.value=true;error.value='';try{const result=await api<Page<System>>(`/warehouse/projects/${props.project}/systems?q=${encodeURIComponent(q.value)}&environment=${encodeURIComponent(environment.value)}&lifecycle=${lifecycle.value}&limit=25&offset=${(page.value-1)*25}`);if(current===generation){rows.value=result.items;total.value=result.total}}catch(e){if(current===generation)error.value=(e as Error).message}finally{if(current===generation)busy.value=false}}
async function detail(row:System){error.value='';try{const result=await api<{system:System;instances:Instance[]}>(`/warehouse/projects/${props.project}/systems/${row.id}`);selected.value=result.system;instances.value=result.instances}catch(e){error.value=(e as Error).message}}
function open(edit=false){editing.value=edit;const s=edit?selected.value:null;Object.assign(form,{code:s?.code||'',name:s?.name||'',domain:s?.domain||'',organization:s?.organization||'',businessOwner:s?.business_owner||'',technicalOwner:s?.technical_owner||'',description:s?.description||'',expectedVersion:s?.revision||0});modal.value=true}
async function save(){busy.value=true;error.value='';try{const result=await api<System>(`/warehouse/projects/${props.project}/systems${editing.value?'/'+selected.value?.id:''}`,form);modal.value=false;await load();await detail(result)}catch(e){error.value=(e as Error).message}finally{busy.value=false}}
async function saveInstance(){if(!selected.value)return;busy.value=true;error.value='';try{await api(`/warehouse/projects/${props.project}/systems/${selected.value.id}/instances`,instanceForm);instanceModal.value=false;await detail(selected.value);await load()}catch(e){error.value=(e as Error).message}finally{busy.value=false}}
watch(()=>props.project,()=>{selected.value=null;page.value=1;void load()});watch(page,()=>void load());onMounted(()=>void load())
</script>
<template>
  <n-alert v-if="error" type="error" class="gap">{{error}}</n-alert>
  <n-card v-if="!selected" title="系统目录">
    <template #header-extra><n-button v-if="canManage" type="primary" @click="open()">登记业务系统</n-button></template>
    <p class="muted">当前项目授权范围内的系统与实例。目录可见性与数据权限分别管理。</p>
    <n-space class="gap"><n-input v-model:value="q" placeholder="系统、编码、组织或责任人" @keyup.enter="page=1;load()" style="width:270px"/><n-select v-model:value="environment" :options="[{label:'全部环境',value:''},...environmentOptions]" style="width:130px"/><n-select v-model:value="lifecycle" :options="[{label:'全部状态',value:''},...Object.entries(lifecycleNames).map(([value,label])=>({value,label}))]" style="width:130px"/><n-button @click="page=1;load()">搜索</n-button></n-space>
    <n-data-table :columns="columns" :data="rows" :loading="busy" :row-key="row=>row.id"/>
    <n-pagination v-model:page="page" :item-count="total" :page-size="25" class="gap"/>
  </n-card>
  <template v-else>
    <n-space class="gap"><n-button @click="selected=null">返回目录</n-button><n-button v-if="canManage" @click="open(true)">编辑系统信息</n-button></n-space>
    <n-card :title="selected.name">
      <n-descriptions :column="3" bordered><n-descriptions-item label="系统编码">{{selected.code}}</n-descriptions-item><n-descriptions-item label="业务责任人">{{selected.business_owner}}</n-descriptions-item><n-descriptions-item label="技术责任人">{{selected.technical_owner}}</n-descriptions-item><n-descriptions-item label="业务域">{{selected.domain||'未填写'}}</n-descriptions-item><n-descriptions-item label="组织">{{selected.organization||'未填写'}}</n-descriptions-item><n-descriptions-item label="登记状态">{{lifecycleNames[selected.lifecycle]}}</n-descriptions-item></n-descriptions>
      <p>{{selected.description}}</p>
    </n-card>
    <n-card title="环境实例" class="gap"><template #header-extra><n-button v-if="canManage" @click="Object.assign(instanceForm,{code:'',name:'',environment:'TEST',purpose:''});instanceModal=true">新增实例</n-button></template><n-data-table :columns="instanceColumns" :data="instances"/><slot name="connections" :system="selected" :instances="instances"/></n-card>
    <IngestionManager v-if="canIngest" :project="project" :instances="instances" :can-manage="canIngest"/>
  </template>
  <n-modal v-model:show="modal" preset="card" :title="editing?'编辑系统信息':'登记业务系统'" style="width:min(650px,94vw)">
    <n-alert v-if="error" type="error" class="gap">{{error}}</n-alert>
    <n-form-item label="稳定编码"><n-input v-model:value="form.code" :disabled="editing" placeholder="例如 erp；登记后不变"/></n-form-item>
    <n-form-item label="系统名称"><n-input v-model:value="form.name"/></n-form-item>
    <n-space><n-form-item label="业务域"><n-input v-model:value="form.domain"/></n-form-item><n-form-item label="归属组织"><n-input v-model:value="form.organization"/></n-form-item></n-space>
    <n-space><n-form-item label="业务责任人"><n-input v-model:value="form.businessOwner"/></n-form-item><n-form-item label="技术责任人"><n-input v-model:value="form.technicalOwner"/></n-form-item></n-space>
    <n-form-item label="说明"><n-input v-model:value="form.description" type="textarea"/></n-form-item><n-button type="primary" :loading="busy" @click="save">保存</n-button>
  </n-modal>
  <n-modal v-model:show="instanceModal" preset="card" title="新增环境实例" style="width:min(540px,94vw)">
    <n-alert v-if="error" type="error" class="gap">{{error}}</n-alert>
    <n-form-item label="实例编码"><n-input v-model:value="instanceForm.code"/></n-form-item><n-form-item label="实例名称"><n-input v-model:value="instanceForm.name"/></n-form-item><n-form-item label="源系统环境"><n-select v-model:value="instanceForm.environment" :options="environmentOptions"/></n-form-item><n-form-item label="用途"><n-input v-model:value="instanceForm.purpose"/></n-form-item><n-button type="primary" :loading="busy" @click="saveInstance">保存</n-button>
  </n-modal>
</template>
