<script setup lang="ts">
import { ref,watch } from 'vue'
import { NAlert,NButton,NCard,NCheckbox,NDataTable,NFormItem,NInput,NModal,NSelect,NSpace,NTag } from 'naive-ui'
import { api } from './api'
const props=defineProps<{project:number;instance:number;canManage:boolean}>()
interface Member{sourceId:number;name?:string;required:boolean;deadline:string;businessDayOffset:number;enabled?:boolean}
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date())
const day=ref(today()),status=ref<Record<string,any>|null>(null),members=ref<Member[]>([]),version=ref(0),timezone=ref('Asia/Shanghai'),effectiveFrom=ref(today()),reason=ref(''),show=ref(false),busy=ref(false),error=ref('')
const route=()=>`/warehouse/projects/${props.project}/instances/${props.instance}/delivery`
const names:Record<string,string>={NOT_CHECKED:'尚未冻结检查',COMPLETE:'必需交付已到齐',INCOMPLETE:'必需交付未齐',NO_SCHEDULE:'当日无计划',NO_REQUIRED_DELIVERY:'无必需交付项',PARTIAL_SCOPE:'仅能查看部分交付'}
const columns=[{title:'通道',key:'name'},{title:'业务日期',key:'businessDate'},{title:'采集时区',key:'timezone'},{title:'必需',key:'required',render:(r:any)=>r.required?'是':'否'},{title:'状态',key:'state'},{title:'已过截止',key:'overdue',render:(r:any)=>r.overdue?'是':'否'}]
let generation=0
async function load(){const current=++generation;error.value='';try{const result=await api<Record<string,any>>(route()+'?day='+day.value);if(current===generation)status.value=result}catch(e){if(current===generation)error.value=(e as Error).message}}
async function check(){busy.value=true;error.value='';try{await api(route()+'/check',{day:day.value});await load()}catch(e){error.value=(e as Error).message}finally{busy.value=false}}
async function configure(){busy.value=true;error.value='';try{const agreements=await api<{version:number;timezone:string;contract:{channels:Member[]}}[]>(route()+'/agreements');const latest=agreements[0];version.value=latest?.version||0;timezone.value=latest?.timezone||'Asia/Shanghai';effectiveFrom.value=today();reason.value='';const connections=await api<{id:number}[]>(`/warehouse/projects/${props.project}/instances/${props.instance}/connections`);const available=(await Promise.all(connections.map(c=>api<{source_id:number;name:string}[]>(`/warehouse/projects/${props.project}/connections/${c.id}/channels`)))).flat();members.value=available.map(ch=>{const old=latest?.contract.channels.find(c=>c.sourceId===ch.source_id);return {sourceId:ch.source_id,name:ch.name,required:true,deadline:'09:00',businessDayOffset:0,...old,enabled:!!old}});show.value=true}catch(e){error.value=(e as Error).message}finally{busy.value=false}}
async function save(){busy.value=true;error.value='';try{await api(route()+'/agreements',{expectedVersion:version.value,timezone:timezone.value,effectiveFrom:effectiveFrom.value,reason:reason.value,channels:members.value.filter(m=>m.enabled).map(({sourceId,required,deadline,businessDayOffset})=>({sourceId,required,deadline,businessDayOffset}))});show.value=false;await check()}catch(e){error.value=(e as Error).message}finally{busy.value=false}}
watch(()=>[props.project,props.instance],()=>{status.value=null;void load()},{immediate:true})
</script>
<template>
  <n-card title="每日交付完整性" class="gap">
    <p class="muted">按当前项目的交付约定汇总。检查后固定应交范围，后续修改不覆盖历史分母。</p>
    <n-space align="center"><n-input v-model:value="day" placeholder="YYYY-MM-DD" style="width:150px"/><n-button @click="load">查询</n-button><n-button v-if="canManage" :loading="busy" @click="check">检查并冻结应交范围</n-button><n-button v-if="canManage" @click="configure">配置交付约定</n-button><n-tag>{{names[status?.state]||status?.state||'加载中'}}</n-tag></n-space>
    <n-alert v-if="error" type="error" class="gap">{{error}}</n-alert>
    <p v-if="status?.required!==undefined">必需项 {{status.complete}} / {{status.required}} · 约定版本 {{status.agreementVersion}}</p>
    <n-data-table :columns="columns" :data="status?.items||[]" class="gap"/>
  </n-card>
  <n-modal v-model:show="show" preset="card" title="配置实例交付约定" style="width:min(880px,96vw)">
    <n-alert v-if="error" type="error" class="gap">{{error}}</n-alert>
    <n-space><n-form-item label="生效日期"><n-input v-model:value="effectiveFrom"/></n-form-item><n-form-item label="汇总时区"><n-input v-model:value="timezone"/></n-form-item></n-space>
    <n-space v-for="member in members" :key="member.sourceId" align="center" class="gap"><n-checkbox v-model:checked="member.enabled">{{member.name}}</n-checkbox><n-checkbox v-model:checked="member.required">必需</n-checkbox><n-input v-model:value="member.deadline" placeholder="截止时间 HH:mm" style="width:140px"/><n-select v-model:value="member.businessDayOffset" :options="[{label:'前一业务日',value:-1},{label:'相同业务日',value:0},{label:'后一业务日',value:1}]" style="width:150px"/></n-space>
    <n-form-item label="修改原因"><n-input v-model:value="reason"/></n-form-item><n-button type="primary" :loading="busy" @click="save">保存新版本</n-button>
  </n-modal>
</template>
