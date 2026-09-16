<script setup lang="ts">
import { ref } from 'vue'
import { NAlert, NModal, useMessage } from 'naive-ui'
import { useApi } from '../../../shared/composables/useApi'
import type { Dataset } from '../../../shared/types'
import ReasonForm from '../../../shared/components/ReasonForm.vue'
import { datasetApi } from '../api'
import type { BuildInput, ModelInput, ModelVersion, PolicyInput } from '../types'
import ModelForm from './ModelForm.vue'
import BuildForm from './BuildForm.vue'
import PolicyForm from './PolicyForm.vue'

const props = defineProps<{ project: number }>()
const emit = defineEmits<{ saved: [dataset: number | null] }>()
const { call, loading, error, run } = useApi()
const api = datasetApi(call, props.project)
const message = useMessage()
const show = ref(false)
const title = ref('')
const operation = ref<'model' | 'build' | 'publish' | 'policy'>('model')
const target = ref<Dataset | null>(null)
const versions = ref<ModelVersion[]>([])
const buildId = ref<number | null>(null)
const editing = ref(false)
const initial = ref<ModelInput>({
  code: '',
  name: '',
  runtimeRef: '',
  expectedVersion: 0,
  gitRevision: '',
  bundleSha256: '',
  contract: {},
})

function open(kind: typeof operation.value, heading: string, dataset: Dataset | null) {
  operation.value = kind
  title.value = heading
  target.value = dataset
  error.value = ''
  show.value = true
}
function register(dataset: Dataset | null, version?: ModelVersion) {
  editing.value = !!version
  initial.value
    = dataset && version
      ? {
          code: dataset.code,
          name: dataset.name,
          expectedVersion: dataset.active_model_version,
          runtimeRef: version.runtime_ref,
          gitRevision: version.git_revision,
          bundleSha256: version.bundle_sha256,
          contract: version.contract,
        }
      : {
          code: '',
          name: '',
          runtimeRef: '',
          expectedVersion: 0,
          gitRevision: '',
          bundleSha256: '',
          contract: {},
        }
  open('model', version ? '登记模型新版本' : '登记模型', dataset)
}
function build(dataset: Dataset, items: ModelVersion[]) {
  versions.value = items
  open('build', '构建候选', dataset)
}
function publish(dataset: Dataset, id: number) {
  buildId.value = id
  open('publish', `发布候选 #${id}`, dataset)
}
function policy(dataset: Dataset) {
  open('policy', '数据授权', dataset)
}
function save(action: () => Promise<number | null>) {
  void run(async () => {
    const selected = await action()
    show.value = false
    message.success('操作已提交')
    emit('saved', selected)
  })
}
function saveModel(input: ModelInput) {
  save(async () => (await api.register(input)).id)
}
function saveBuild(input: BuildInput) {
  const id = target.value?.id
  if (id) {
    save(async () => {
      await api.build(id, input)
      return null
    })
  }
}
function savePolicy(input: PolicyInput) {
  const id = target.value?.id
  if (id) {
    save(async () => {
      await api.policy(id, input)
      return null
    })
  }
}
function savePublication(reason: string) {
  const id = target.value?.id
  const candidate = buildId.value
  if (id && candidate) {
    save(async () => {
      await api.publish(id, candidate, reason)
      return null
    })
  }
}
defineExpose({ register, build, publish, policy })
</script>
<template>
  <NModal
    v-model:show="show"
    preset="card"
    class="action-modal"
    :title="title"
    :mask-closable="!loading"
    :closable="!loading"
  >
    <NAlert v-if="error" type="error" class="section-gap">
      {{ error }}
    </NAlert>
    <ModelForm
      v-if="operation === 'model'"
      :initial="initial"
      :editing="editing"
      :busy="loading"
      @submit="saveModel"
    />
    <BuildForm
      v-else-if="operation === 'build'"
      :versions="versions"
      :version="target?.active_model_version ?? 1"
      :busy="loading"
      @submit="saveBuild"
    />
    <PolicyForm v-else-if="operation === 'policy'" :busy="loading" @submit="savePolicy" />
    <ReasonForm
      v-else
      label="发布理由"
      :busy="loading"
      @submit="savePublication"
    />
  </NModal>
</template>
