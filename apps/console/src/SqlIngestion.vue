<script setup lang="ts">
// Registered-SQL definition panel: editor, validation, mandatory preview, versioning.
// It is the whole "自定义 SQL" step of the ingestion wizard, and it is also what makes a
// registered-SQL channel activatable: a version only exists after a preview really ran.
import { computed,onMounted,ref } from 'vue'
import { NAlert,NButton,NCard,NCheckbox,NDataTable,NFormItem,NInput,NRadio,NRadioGroup,NSelect,NSpace,NTag,NTree,type DataTableColumns,type TreeOption } from 'naive-ui'
import { api } from './api'
const props=defineProps<{project:number;source:number;canActivate:boolean}>()
const emit=defineEmits<{ready:[boolean]}>()
interface Column {name:string;type:string;inferred?:boolean}
interface Preview {id:number;state:string;columns?:Column[];rows?:unknown[][];row_count?:number;truncated?:boolean;elapsed_ms?:number;error_code?:string}
interface Version {id:number;version:number;state:string;extraction_mode:string;watermark_column?:string|null;grain:string;unique_key:string[];result_columns:Column[];created_by:string;created_at:string;enabled_by?:string|null;reason?:string|null}
const draft=ref<{sql_text?:string;grain?:string;unique_key?:string[];masked_columns?:string[]}|null>(null)
const availableTables=ref<string[]>([]),availableSchemas=ref<string[]>([]),tableFilter=ref('')
const datasourceType=ref(''),statementTimeoutMs=ref(0),previewLimit=ref(1000)
const editor=ref<{textareaEl?:HTMLTextAreaElement}|null>(null)
const extractionMode=ref<'FULL'|'UPDATED_AT_KEYSET'>('FULL'),watermarkColumn=ref<string|null>(null)
const sqlText=ref(''),grain=ref(''),uniqueKey=ref(''),masked=ref('')
const issues=ref<{level:string;code:string;message:string;line?:number|null}[]>([]),referencedTables=ref<string[]>([])
const versions=ref<Version[]>([]),preview=ref<Preview|null>(null),previewBusy=ref(false),previewId=ref<number|null>(null)
const status=ref(''),error=ref(''),busy=ref(false)
// The preview columns only exist after the worker finishes, so this must stay reactive: a plain
// constant froze the grid at the single row-number column.
const columns=computed<DataTableColumns<unknown[]>>(()=>[
  {title:'#',key:'index',width:60,render:(_,index)=>String(index+1)},
  ...(preview.value?.columns||[]).map((column,index)=>({title:`${column.name}${column.inferred?' ·':''}`,key:String(column.name),render:(row:unknown[])=>format(row[index])})),
])
const rows=computed(()=>preview.value?.rows||[])
const hasVersion=computed(()=>versions.value.some(v=>v.state==='ENABLED'||v.state==='VALIDATED'))
const enabledVersion=computed(()=>versions.value.find(v=>v.state==='ENABLED')||null)
function format(value:unknown){if(value===null||value===undefined)return '∅';const text=String(value);return text.length>120?`${text.slice(0,120)}…`:text}
// The tree only ever contains administrator-approved objects, so the editor cannot suggest an
// object the validator would reject.
const treeData=computed<TreeOption[]>(()=>{
  const needle=tableFilter.value.trim().toLowerCase()
  const match=(table:string)=>!needle||table.toLowerCase().includes(needle)
  const bare=(table:string)=>!table.includes('.')
  // Approved tables are stored unqualified whenever the datasource allows a single schema, so a
  // bare name belongs to that schema instead of to no schema at all.
  const onlySchema=availableSchemas.value.length===1?availableSchemas.value[0]:null
  const belongs=(table:string,schema:string)=>{
    if(schema&&table.startsWith(`${schema}.`))return true
    return bare(table)&&(onlySchema===schema||(onlySchema===null&&schema===''))
  }
  const schemas=availableSchemas.value.length?availableSchemas.value:['']
  const nodes=schemas.map(schema=>{
    const tables=availableTables.value.filter(table=>belongs(table,schema)&&match(table))
      .map(table=>({key:table,label:table.replace(/^[^.]+\./u,''),isLeaf:true}))
    return {key:`schema:${schema}`,label:schema||'（未标注库）',children:tables,isLeaf:tables.length===0}
  }).filter(node=>(node.children as TreeOption[]).length>0)
  if(availableSchemas.value.length>1){
    const orphans=availableTables.value.filter(table=>bare(table)&&match(table)).map(table=>({key:table,label:table,isLeaf:true}))
    if(orphans.length)nodes.push({key:'schema:',label:'（未标注库）',children:orphans,isLeaf:false})
  }
  return nodes
})
function insert(token:string){
  const element=editor.value?.textareaEl
  if(!element){sqlText.value+=token;return}
  const start=element.selectionStart??sqlText.value.length,end=element.selectionEnd??start
  sqlText.value=`${sqlText.value.slice(0,start)}${token}${sqlText.value.slice(end)}`
  requestAnimationFrame(()=>{element.focus();const caret=start+token.length;element.setSelectionRange(caret,caret)})
}
function insertObject(table:string){insert(table.includes('.')?`\`${table.split('.').join('`.`')}\``:`\`${table}\``)}
function insertColumn(column:string){insert(`\`${column}\``)}
const resultColumns=computed(()=>preview.value?.columns||[])
function onTreeSelect(keys:Array<string|number>){const key=String(keys[0]??'');if(key.startsWith('schema:'))return;insertObject(key)}
const extractionModes=[{value:'FULL',label:'全量快照'},{value:'UPDATED_AT_KEYSET',label:'水位增量（P0-c 未实现）'}]
async function load(){error.value='';try{const result=await api<{draft:any;datasource:{datasourceType:string;availableTables:string[];availableSchemas:string[];statementTimeoutMs:number};previewLimit:number}>(`/warehouse/projects/${props.project}/channels/${props.source}/sql`);draft.value=result.draft;availableTables.value=result.datasource.availableTables||[];availableSchemas.value=result.datasource.availableSchemas||[];datasourceType.value=result.datasource.datasourceType||'';statementTimeoutMs.value=result.datasource.statementTimeoutMs||0;previewLimit.value=result.previewLimit||1000;if(result.draft){sqlText.value=result.draft.sql_text||'';grain.value=result.draft.grain||'';uniqueKey.value=(result.draft.unique_key||[]).join(', ');masked.value=(result.draft.masked_columns||[]).join(', ')}await loadVersions()}catch(e){error.value=(e as Error).message}}
async function loadVersions(){versions.value=await api<Version[]>(`/warehouse/projects/${props.project}/channels/${props.source}/sql/versions`);emit('ready',versions.value.some(v=>v.state==='ENABLED'))}
const payload=()=>({sqlText:sqlText.value,maskedColumns:masked.value.split(',').map(v=>v.trim()).filter(Boolean),grain:grain.value.trim(),uniqueKey:uniqueKey.value.split(',').map(v=>v.trim()).filter(Boolean)})
async function validate(){busy.value=true;error.value='';try{const result=await api<{blocked:boolean;issues:typeof issues.value;referencedTables:string[]}>(`/warehouse/projects/${props.project}/channels/${props.source}/sql/validate`,{sqlText:sqlText.value});issues.value=result.issues;referencedTables.value=result.referencedTables}catch(e){error.value=(e as Error).message}finally{busy.value=false}}
async function saveDraft(){busy.value=true;error.value='';try{const result=await api<{saved:boolean;issues:typeof issues.value}>(`/warehouse/projects/${props.project}/channels/${props.source}/sql/draft`,payload());issues.value=result.issues;status.value=result.saved?'草稿已保存':'存在阻断问题，未保存'}catch(e){error.value=(e as Error).message}finally{busy.value=false}}
async function runPreview(){busy.value=true;error.value='';preview.value=null;previewId.value=null;status.value='已提交预览，等待工作器执行…';try{await api(`/warehouse/projects/${props.project}/channels/${props.source}/sql/draft`,payload());const queued=await api<{queued:boolean;issues?:typeof issues.value;preview?:{id:number}}>(`/warehouse/projects/${props.project}/channels/${props.source}/sql/previews`,{requestKey:crypto.randomUUID()});if(queued.issues?.length)issues.value=queued.issues;if(!queued.preview){status.value='存在阻断问题，未提交预览';return}previewId.value=queued.preview.id;await pollPreview()}catch(e){error.value=(e as Error).message}finally{busy.value=false}}
async function pollPreview(){if(!previewId.value)return;previewBusy.value=true;try{for(let attempt=0;attempt<60;attempt++){const result=await api<Preview>(`/warehouse/projects/${props.project}/channels/${props.source}/sql/previews/${previewId.value}`);preview.value=result;if(['COMPLETED','FAILED'].includes(result.state)){status.value=result.state==='COMPLETED'?`预览完成：${result.row_count??0} 行 · ${result.elapsed_ms??0} ms${result.truncated?' · 已截断':''}`:`预览失败：${result.error_code||'未知原因'}`;return}await new Promise(resolve=>setTimeout(resolve,1500))}status.value='预览超时，请稍后查看'}catch(e){error.value=(e as Error).message}finally{previewBusy.value=false}}
async function saveVersion(){busy.value=true;error.value='';try{await api(`/warehouse/projects/${props.project}/channels/${props.source}/sql/draft`,payload());// The API rejects an explicit null watermark, so the field is only sent for the incremental mode.
    const versionBody:Record<string,unknown>={extractionMode:extractionMode.value};
    if(extractionMode.value==='UPDATED_AT_KEYSET')versionBody.watermarkColumn=watermarkColumn.value;
    await api(`/warehouse/projects/${props.project}/channels/${props.source}/sql/versions`,versionBody);status.value='已保存为新版本（待启用）';await loadVersions()}catch(e){error.value=(e as Error).message}finally{busy.value=false}}
const enableReason=ref('')
async function enableVersion(version:Version){if(!enableReason.value.trim()){error.value='启用新版本必须填写原因';return}busy.value=true;error.value='';try{await api(`/warehouse/projects/${props.project}/channels/${props.source}/sql/versions/${version.id}/enable`,{reason:enableReason.value.trim()});enableReason.value='';status.value=`版本 ${version.version} 已启用`;await load()}catch(e){error.value=(e as Error).message}finally{busy.value=false}}
const versionColumns:DataTableColumns<Version>=[{title:'版本',key:'version'},{title:'状态',key:'state',render:row=>row.state==='ENABLED'?'已启用':row.state==='VALIDATED'?'待启用':'已退役'},{title:'模式',key:'extraction_mode',render:row=>row.extraction_mode==='FULL'?'全量快照':'水位增量'},{title:'结果列',key:'result_columns',render:row=>(row.result_columns||[]).length},{title:'启用',key:'enabled_by',render:row=>row.enabled_by||'—'}]
onMounted(()=>void load())
</script>

<template>
  <n-card title="自定义 SQL（登记式）" class="gap">
    <n-alert type="info" class="gap">只允许单条只读查询（含 JOIN/UNION/聚合）；禁止写入、改结构、跨库与系统库。正式执行前必须成功预览一次，平台会按结果列自动把精度敏感列转为文本。</n-alert>
    <n-alert v-if="error" type="error" class="gap">{{error}}</n-alert>
    <n-alert v-if="status" type="success" class="gap">{{status}}</n-alert>
    <n-space class="gap"><n-tag>数据源 {{datasourceType||'未配置'}}</n-tag><n-tag>预览上限 {{previewLimit}} 行（不可调大）</n-tag><n-tag>语句超时 {{Math.round(statementTimeoutMs/1000)}} 秒</n-tag></n-space>
    <n-space vertical class="gap">
      <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
        <div style="flex:0 0 260px;min-width:220px">
          <div class="muted">已批准对象（点击插入）</div>
          <n-input v-model:value="tableFilter" size="small" clearable placeholder="搜索库/表" aria-label="搜索已批准对象"/>
          <div style="max-height:260px;overflow:auto;border:1px solid var(--n-border-color);border-radius:4px;margin-top:6px" data-test="approved-table-tree">
            <n-tree v-if="treeData.length" block-line default-expand-all :data="treeData" :pattern="tableFilter" :show-irrelevant-nodes="false" :selectable="true" @update:selected-keys="onTreeSelect"/>
            <p v-else class="muted" style="padding:8px">该数据源尚未登记允许的表；请先在数据源配置里填写允许的库与表。</p>
          </div>
          <div class="muted" v-if="resultColumns.length" style="margin-top:8px">结果列（点击插入列名）：
            <n-button v-for="column in resultColumns" :key="column.name" size="tiny" class="gap" @click="insertColumn(column.name)">{{column.name}}</n-button>
          </div>
        </div>
        <div style="flex:1 1 520px;min-width:320px">
          <n-input ref="editor" v-model:value="sqlText" type="textarea" :autosize="{minRows:6,maxRows:16}" placeholder="SELECT id, CAST(amount AS CHAR) AS amount FROM biz_order" aria-label="SQL 文本"/>
        </div>
      </div>
      <n-space><n-form-item label="粒度"><n-input v-model:value="grain" placeholder="例如 一行一个订单" aria-label="粒度"/></n-form-item><n-form-item label="唯一键"><n-input v-model:value="uniqueKey" placeholder="order_id 或 id,team" aria-label="唯一键"/></n-form-item><n-form-item label="脱敏列"><n-input v-model:value="masked" placeholder="逗号分隔，预览时显示为 ***" aria-label="脱敏列"/></n-form-item></n-space>
      <n-space align="center">
        <n-form-item label="抽取模式"><n-radio-group v-model:value="extractionMode" aria-label="抽取模式"><n-radio v-for="mode in extractionModes" :key="mode.value" :value="mode.value">{{mode.label}}</n-radio></n-radio-group></n-form-item>
        <n-form-item v-if="extractionMode==='UPDATED_AT_KEYSET'" label="水位列"><n-select v-model:value="watermarkColumn" style="min-width:180px" :options="resultColumns.map(c=>({label:c.name,value:c.name}))" placeholder="来自预览结果列" aria-label="水位列"/></n-form-item>
      </n-space>
      <n-alert v-if="extractionMode==='UPDATED_AT_KEYSET'" type="warning" class="gap" data-test="incremental-not-implemented">水位增量只做定义与版本记录：执行层目前仍只能跑全量快照（P0-c 待实现），因此该模式下的版本无法启用。</n-alert>
      <n-space><n-button :loading="busy" @click="validate">校验</n-button><n-button :loading="busy" @click="saveDraft">保存草稿</n-button><n-button type="primary" :loading="busy||previewBusy" @click="runPreview">预览数据（最多 {{previewLimit}} 行）</n-button><n-button :disabled="!preview||preview.state!=='COMPLETED'" :loading="busy" @click="saveVersion">保存为新版本</n-button></n-space>
    </n-space>
    <n-alert v-for="issue in issues" :key="`${issue.code}-${issue.line}`" :type="issue.level==='BLOCK'?'error':'warning'" class="gap">{{issue.level==='BLOCK'?'阻断':'警告'}}：{{issue.message}}<template v-if="issue.line">（第 {{issue.line}} 行）</template></n-alert>
  </n-card>
  <n-card v-if="preview" title="预览结果" class="gap">
    <div data-test="sql-preview-grid"><n-data-table :columns="columns" :data="rows" :max-height="320" size="small"/></div>
    <p class="muted">本次抽样：{{preview.row_count??0}} 行<template v-if="preview.truncated">（已截断，仅显示上限内的行）</template> · 耗时 {{preview.elapsed_ms??0}} ms。列名带 · 表示类型是推断值。</p>
  </n-card>
  <n-card title="SQL 版本" class="gap">
    <div data-test="sql-version-table"><n-data-table :columns="versionColumns" :data="versions" size="small"/></div>
    <n-space class="gap" align="center"><n-form-item label="启用原因（必填）"><n-input v-model:value="enableReason" aria-label="启用原因"/></n-form-item><n-button v-for="version in versions.filter(v=>v.state==='VALIDATED')" :key="version.id" :disabled="!canActivate" :loading="busy" @click="enableVersion(version)">启用版本 {{version.version}}</n-button></n-space>
    <p class="muted" v-if="enabledVersion">当前启用：版本 {{enabledVersion.version}}（{{enabledVersion.extraction_mode==='FULL'?'全量快照':'水位增量'}}）</p>
    <p class="muted" v-else>还没有启用的 SQL 版本：必须成功预览一次并保存版本后才能启用。</p>
    <p class="muted" v-if="!canActivate">启用需要项目 OWNER 或平台管理员权限。</p>
  </n-card>
</template>
