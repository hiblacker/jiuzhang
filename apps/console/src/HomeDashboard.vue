<script setup lang="ts">
import { onMounted,ref,watch } from 'vue'
import { NAlert,NButton,NCard,NDataTable,NSpace,NTag } from 'naive-ui'
import { api,type Page } from './api'
const props=defineProps<{project:number}>()
const emit=defineEmits<{navigate:[string]}>()
const error=ref(''),incidents=ref<Record<string,any>[]>([]),datasets=ref<Record<string,any>[]>([]),sourceCount=ref(0),datasetCount=ref(0),incidentCount=ref(0)
let generation=0
async function load(){const current=++generation;try{const [sources,data,issues]=await Promise.all([api<Page<Record<string,any>>>(`/warehouse/catalog/projects/${props.project}/sources?limit=1`),api<Page<Record<string,any>>>(`/warehouse/catalog/projects/${props.project}/datasets?limit=5`),api<Page<Record<string,any>>>(`/warehouse/projects/${props.project}/incidents?state=OPEN&limit=5`)]);const descriptions=await Promise.all(data.items.map(d=>api<Record<string,any>>(`/warehouse/projects/${props.project}/datasets/${d.id}/description`)));if(current===generation){sourceCount.value=sources.total;datasetCount.value=data.total;incidentCount.value=issues.total;incidents.value=issues.items;datasets.value=descriptions;error.value=''}}catch(e){if(current===generation)error.value=(e as Error).message}}
const names:Record<string,string>={STALE:'已过期',FRESH:'满足要求',NOT_CONFIGURED:'未定义新鲜度',UNPUBLISHED:'未发布',UNKNOWN:'未知'}
watch(()=>props.project,()=>void load());onMounted(()=>void load())
</script>
<template>
  <n-alert v-if="error" type="error" class="gap">{{error}}</n-alert>
  <section class="cards"><n-card title="统一接入"><h2>{{sourceCount}} 条采集来源</h2><p>业务系统、环境、连接与每日交付。</p><n-button @click="emit('navigate','systems')">管理接入</n-button></n-card><n-card title="数据服务"><h2>{{datasetCount}} 个数据集</h2><p>固定发布版本、数据新鲜度与行列授权。</p><n-button @click="emit('navigate','datasets')">查看数据服务</n-button></n-card><n-card title="待处理异常"><h2>{{incidentCount}} 项</h2><p>确认处理责任，跟踪实际恢复。</p><n-button @click="emit('navigate','runs')">进入运行中心</n-button></n-card></section>
  <n-card title="数据集状态（前 5 项）" class="gap"><n-data-table :columns="[{title:'名称',key:'name'},{title:'当前发布',key:'active_release_id'},{title:'新鲜度',key:'freshness',render:(r:any)=>names[r.freshness.state]},{title:'本轮任务',key:'task',render:(r:any)=>r.freshness.currentTask.state}]" :data="datasets"/></n-card>
  <n-card title="最近待处理异常（前 5 项）" class="gap"><n-data-table :columns="[{title:'系统',key:'system_name'},{title:'来源',key:'source_code'},{title:'数据集',key:'dataset_name'},{title:'原因',key:'category'}]" :data="incidents"/><n-space class="gap"><n-tag>当前项目授权范围</n-tag><n-button @click="load">刷新状态</n-button></n-space></n-card>
</template>
