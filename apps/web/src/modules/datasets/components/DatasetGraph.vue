<script setup lang="ts">
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

import { computed, ref } from 'vue'
import { VueFlow, type Connection, type NodeChange, type EdgeChange } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { NButton, NInput, NSelect, NAlert } from 'naive-ui'
import type { Model } from '@/shared/api/types'
import { connectionIssue } from '../model/graph'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
const real = import.meta.env.VITE_API_MODE === 'real'
const nodes = defineModel<Model<'Node'>[]>('nodes', { required: true })
const edges = defineModel<Model<'Edge'>[]>('edges', { required: true })
const props = defineProps<{ readonly?: boolean }>()
const selected = ref(''),
  type = ref<Model<'Node'>['type']>('filter')
const labels = {
  input: uiText('ui.dataset_graph_e8850440'),
  filter: uiText('ui.dataset_graph_5270860e'),
  fields: uiText('ui.dataset_graph_77a49f2c'),
  join: uiText('ui.dataset_graph_dc91aa56'),
  union: uiText('ui.dataset_graph_e5badf90'),
  aggregate: uiText('ui.dataset_graph_e0a1d812'),
}
const flowNodes = computed(() =>
  nodes.value.map((n) => ({
    id: n.id,
    position: { x: n.x, y: n.y },
    data: { label: n.label },
    type: n.type === 'input' ? 'input' : 'default',
  })),
)
const current = computed(() => nodes.value.find((n) => n.id === selected.value))
const inputEdges = computed(() => edges.value.filter((edge) => edge.target === selected.value))
function swapInputs() {
  if (props.readonly || current.value?.type !== 'join' || inputEdges.value.length !== 2) return
  const first = edges.value.findIndex((edge) => edge.id === inputEdges.value[0]!.id)
  const second = edges.value.findIndex((edge) => edge.id === inputEdges.value[1]!.id)
  const next = [...edges.value]
  ;[next[first], next[second]] = [next[second]!, next[first]!]
  edges.value = next
}
const from = ref<string | null>(null),
  to = ref<string | null>(null),
  error = ref('')
const nodeOptions = computed(() =>
  nodes.value.map((node) => ({ value: node.id, label: node.label + ' · ' + node.id.slice(0, 8) })),
)
const flowEdges = computed(() => edges.value.map((edge) => ({ ...edge })))
function removeEdge(id: string) {
  if (!props.readonly) edges.value = edges.value.filter((edge) => edge.id !== id)
}
function edgeChanges(changes: EdgeChange[]) {
  if (props.readonly) return
  const removed = new Set(
    changes.filter((change) => change.type === 'remove').map((change) => change.id),
  )
  if (removed.size) edges.value = edges.value.filter((edge) => !removed.has(edge.id))
}
function nodeChanges(changes: NodeChange[]) {
  if (props.readonly) return
  const removed = new Set(
    changes.filter((change) => change.type === 'remove').map((change) => change.id),
  )
  if (!removed.size) return
  nodes.value = nodes.value.filter((node) => !removed.has(node.id))
  edges.value = edges.value.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target))
  if (removed.has(selected.value)) selected.value = ''
}
const configHelp = computed(
  () =>
    ({
      input: uiText('datasets.inputConfig'),
      filter: uiText('datasets.filterConfig'),
      fields: uiText('datasets.fieldsConfig'),
      join: uiText('datasets.joinConfig'),
      union: uiText('datasets.unionConfig'),
      aggregate: uiText('datasets.aggregateConfig'),
    })[current.value?.type ?? 'input'],
)
function add() {
  const id = 'node-' + crypto.randomUUID()
  const defaults = {
    input: '',
    filter: 'city=杭州',
    fields: '',
    join: 'left:id=id',
    union: 'all',
    aggregate: 'sum:amount',
  }
  nodes.value = [
    ...nodes.value,
    {
      id,
      type: type.value,
      label: labels[type.value],
      x: 80 + nodes.value.length * 160,
      y: 80,
      config: defaults[type.value],
    },
  ]
  selected.value = id
}
function connect(c: Connection) {
  if (props.readonly) return
  error.value = connectionIssue(nodes.value, edges.value, c.source, c.target)
  if (error.value) return
  edges.value = [...edges.value, { id: crypto.randomUUID(), source: c.source, target: c.target }]
}
function configure(value: string) {
  nodes.value = nodes.value.map((n) => (n.id === selected.value ? { ...n, config: value } : n))
}
function remove() {
  nodes.value = nodes.value.filter((n) => n.id !== selected.value)
  edges.value = edges.value.filter(
    (e) => e.source !== selected.value && e.target !== selected.value,
  )
  selected.value = ''
}
</script>
<template>
  <div class="graph-toolbar">
    <NSelect
      v-model:value="type"
      v-select-trigger-name="uiText('datasets.graph.nodeType')"
      :disabled="readonly"
      style="width: 150px"
      :options="
        Object.entries(labels).map(([value, label]) => ({
          value,
          label,
          disabled: real && !['filter', 'fields'].includes(value),
        }))
      "
    /><NButton :disabled="readonly" @click="add">{{ uiText('ui.dataset_graph_56ba925f') }}</NButton
    ><NButton v-if="current" :disabled="readonly" type="error" quaternary @click="remove">{{
      uiText('ui.dataset_graph_f7920748')
    }}</NButton>
  </div>
  <div class="graph-toolbar">
    <NSelect
      v-model:value="selected"
      :options="nodeOptions"
      v-select-trigger-name="uiText('datasets.graph.selected')"
      :placeholder="uiText('datasets.graph.selected')"
    />
    <NSelect
      v-model:value="from"
      :disabled="readonly"
      :options="nodeOptions"
      v-select-trigger-name="uiText('datasets.graph.from')"
      :placeholder="uiText('datasets.graph.from')"
    />
    <NSelect
      v-model:value="to"
      :disabled="readonly"
      :options="nodeOptions"
      v-select-trigger-name="uiText('datasets.graph.to')"
      :placeholder="uiText('datasets.graph.to')"
    />
    <NButton
      :disabled="readonly || !from || !to"
      @click="
        from && to && connect({ source: from, target: to, sourceHandle: null, targetHandle: null })
      "
      >{{ uiText('datasets.graph.connect') }}</NButton
    >
  </div>
  <NAlert v-if="error" type="error" class="mb">{{
    uiText('datasets.graph.errors.' + error)
  }}</NAlert>
  <div class="graph-canvas">
    <VueFlow
      :nodes="flowNodes"
      :edges="flowEdges"
      :delete-key-code="readonly ? null : ['Backspace', 'Delete']"
      :nodes-draggable="!readonly"
      :nodes-connectable="!readonly"
      fit-view-on-init
      @connect="connect"
      @nodes-change="nodeChanges"
      @edges-change="edgeChanges"
      @node-click="selected = $event.node.id"
      @node-drag-stop="
        nodes = nodes.map((n) =>
          n.id === $event.node.id
            ? { ...n, x: $event.node.position.x, y: $event.node.position.y }
            : n,
        )
      "
      ><Background :gap="20"
    /></VueFlow>
  </div>
  <div v-if="edges.length" class="graph-links">
    <div v-for="edge in edges" :key="edge.id" class="graph-link">
      <span
        >{{ nodes.find((node) => node.id === edge.source)?.label }} →
        {{ nodes.find((node) => node.id === edge.target)?.label }}</span
      >
      <NButton size="tiny" :disabled="readonly" @click="removeEdge(edge.id)">{{
        uiText('datasets.graph.removeEdge')
      }}</NButton>
    </div>
  </div>
  <NAlert v-if="current" type="info" style="margin-top: 16px"
    >{{ current.label }} · {{ current.type }}
    <p>{{ configHelp }}</p>
    <div v-if="current.type === 'join'" class="join-inputs">
      <p>
        {{ uiText('datasets.graph.leftInput') }}:
        {{ nodes.find((node) => node.id === inputEdges[0]?.source)?.label ?? '—' }}
      </p>
      <p>
        {{ uiText('datasets.graph.rightInput') }}:
        {{ nodes.find((node) => node.id === inputEdges[1]?.source)?.label ?? '—' }}
      </p>
      <NButton size="small" :disabled="readonly || inputEdges.length !== 2" @click="swapInputs">{{
        uiText('datasets.graph.swapInputs')
      }}</NButton>
    </div>
    <NInput
      :value="current.config"
      :input-props="{ 'aria-label': uiText('datasets.graph.config') }"
      :disabled="readonly"
      :placeholder="uiText('ui.dataset_graph_dbab4b92')"
      @update:value="configure"
  /></NAlert>
</template>
<style scoped>
.graph-toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.join-inputs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin-bottom: 12px;
}
.graph-toolbar > :deep(.n-select) {
  flex: 1;
  min-width: 160px;
}
.graph-links {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
}
.graph-link {
  display: flex;
  align-items: center;
  gap: 10px;
}
.graph-canvas {
  height: 320px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.graph-canvas :deep(.vue-flow__node) {
  border-color: var(--accent);
  color: var(--textPrimary);
  background: var(--surfaceRaised);
  border-radius: 10px;
  padding: 15px;
}
</style>
