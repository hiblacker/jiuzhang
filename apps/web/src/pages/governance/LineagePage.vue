<script setup lang="ts">
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

import { computed, ref, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VueFlow, useVueFlow, type NodeChange } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { NCard, NButton, NSelect, NAlert, NDescriptions, NDescriptionsItem } from 'naive-ui'
import { useLineage, lineageScope, layoutLineage } from '@/modules/governance'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
const route = useRoute(),
  router = useRouter(),
  focused = ref('')
const scope = computed(() => (route.query.scope === 'field' ? 'field' : 'resource'))
const direction = computed(() =>
  route.query.direction === 'upstream' || route.query.direction === 'downstream'
    ? route.query.direction
    : 'both',
)
const selected = computed(() =>
  typeof route.query.resource === 'string' ? route.query.resource : '',
)
const field = computed(() => (typeof route.query.field === 'string' ? route.query.field : ''))
const resources = useLineage(),
  query = useLineage(scope)
function filter(values: Record<string, string | null>) {
  void router.push({ query: { ...route.query, ...values } })
  focused.value = ''
}
const fieldOptions = computed(() =>
  [
    ...new Set(
      query.data.value?.nodes
        .filter((node) => node.resourceId === selected.value)
        .map((node) => node.fieldName) ?? [],
    ),
  ].map((value) => ({ value, label: value })),
)
const roots = computed(
  () =>
    query.data.value?.nodes
      .filter(
        (node) =>
          node.resourceId === selected.value &&
          (!field.value || scope.value === 'resource' || node.fieldName === field.value),
      )
      .map((node) => node.id) ?? [],
)
const flow = useVueFlow()
const visibleIds = computed(() => {
  if (!selected.value) return null
  return lineageScope(query.data.value?.edges ?? [], roots.value, direction.value)
})
const visibleNodes = computed(() =>
  (query.data.value?.nodes ?? []).filter(
    (node) => !visibleIds.value || visibleIds.value.has(node.id),
  ),
)
const nodes = computed(() =>
  layoutLineage(visibleNodes.value, query.data.value?.edges ?? []).map((node) => ({
    id: node.id,
    position: node.position,
    data: { label: node.label },
    ariaLabel: node.label,
    type: ({ source: 'input', dataset: 'default', table: 'output' } as const)[node.kind],
  })),
)
const edges = computed(
  () =>
    query.data.value?.edges.filter(
      (e) =>
        nodes.value.some((n) => n.id === e.source) && nodes.value.some((n) => n.id === e.target),
    ) ?? [],
)
const detail = computed(() => visibleNodes.value.find((node) => node.id === focused.value))
function selectionChanged(changes: NodeChange[]) {
  const selected = changes.find((change) => change.type === 'select' && change.selected)
  if (selected?.type === 'select') focused.value = selected.id
  else if (
    changes.some(
      (change) => change.type === 'select' && change.id === focused.value && !change.selected,
    )
  )
    focused.value = ''
}
async function locate(id: string | null) {
  focused.value = id ?? ''
  if (id) await flow.fitView({ nodes: [id], maxZoom: 1, padding: 0.6 })
}
function fitGraph() {
  return flow.fitView({ minZoom: 0.05, maxZoom: 1, padding: 0.15 })
}
watch(nodes, async (_, __, onCleanup) => {
  let active = true
  onCleanup(() => {
    active = false
  })
  if (!visibleNodes.value.some((node) => node.id === focused.value)) focused.value = ''
  await nextTick()
  if (active) await fitGraph()
})
</script>
<template>
  <PageHeader :title="uiText('ui.lineage_daa9947a')" :description="uiText('ui.lineage_21ea5894')"
    ><NButton @click="fitGraph()">{{ uiText('ui.lineage_3bc70c8d') }}</NButton
    ><NButton @click="flow.zoomIn()">{{ uiText('lineage.zoomIn') }}</NButton
    ><NButton @click="flow.zoomOut()">{{ uiText('lineage.zoomOut') }}</NButton
    ><NButton @click="router.push('/governance/catalog')">{{
      uiText('ui.lineage_3c41d918')
    }}</NButton></PageHeader
  ><NAlert type="info" class="mb"
    ><p v-for="note in query.data.value?.notes" :key="note">{{ note }}</p></NAlert
  ><NCard :bordered="false">
    <div class="lineage-filters">
      <NSelect
        :value="scope"
        v-select-trigger-name="uiText('lineage.scope')"
        :options="[
          { label: uiText('lineage.resource'), value: 'resource' },
          { label: uiText('lineage.field'), value: 'field' },
        ]"
        @update:value="filter({ scope: $event, field: null })"
      />
      <NSelect
        :value="selected || null"
        clearable
        filterable
        v-select-trigger-name="uiText('openSelect', { label: uiText('lineage.selected') })"
        :input-props="{ 'aria-label': uiText('lineage.selected') }"
        :placeholder="uiText('ui.lineage_9b907c0c')"
        :options="resources.data.value?.nodes.map((n) => ({ value: n.id, label: n.label }))"
        @update:value="filter({ resource: $event, field: null })"
      />
      <NSelect
        :value="direction"
        v-select-trigger-name="uiText('lineage.direction')"
        :options="[
          { label: uiText('lineage.both'), value: 'both' },
          { label: uiText('lineage.upstream'), value: 'upstream' },
          { label: uiText('lineage.downstream'), value: 'downstream' },
        ]"
        @update:value="filter({ direction: $event })"
      />
      <NSelect
        v-if="scope === 'field'"
        :value="field || null"
        :disabled="!selected"
        :options="fieldOptions"
        clearable
        v-select-trigger-name="uiText('lineage.selectedField')"
        :placeholder="uiText('lineage.selectedField')"
        @update:value="filter({ field: $event })"
      />
    </div>
    <NSelect
      :value="focused || null"
      :options="visibleNodes.map((node) => ({ value: node.id, label: node.label }))"
      v-select-trigger-name="uiText('openSelect', { label: uiText('lineage.nodePicker') })"
      :input-props="{ 'aria-label': uiText('lineage.nodePicker') }"
      :placeholder="uiText('lineage.nodePicker')"
      clearable
      filterable
      class="mb"
      @update:value="locate"
    />
    <NAlert type="info" class="mb">{{ uiText('lineage.nodeHint') }}</NAlert>
    <AsyncState
      :loading="query.isLoading.value"
      :error="query.error.value"
      :empty="query.data.value && !nodes.length"
      @retry="query.refetch()"
      ><div class="lineage" role="region" :aria-label="uiText('lineage.canvas')">
        <VueFlow
          :nodes="nodes"
          :edges="edges"
          :nodes-draggable="false"
          :nodes-connectable="false"
          :delete-key-code="null"
          :min-zoom="0.05"
          fit-view-on-init
          @nodes-initialized="fitGraph()"
          @nodes-change="selectionChanged"
          @node-click="focused = $event.node.id"
          ><Background
        /></VueFlow>
      </div>
      <NDescriptions v-if="detail" :column="3" style="margin-top: 24px"
        ><NDescriptionsItem :label="uiText('ui.lineage_c5ca3950')">{{
          detail.label
        }}</NDescriptionsItem
        ><NDescriptionsItem :label="uiText('ui.lineage_e4e46c72')">{{
          detail.kind
        }}</NDescriptionsItem
        ><NDescriptionsItem :label="uiText('ui.lineage_4f55ee1e')"
          ><NButton text type="primary" @click="router.push(detail.path)">{{
            uiText('ui.lineage_66545d0e')
          }}</NButton></NDescriptionsItem
        ></NDescriptions
      ></AsyncState
    ></NCard
  >
</template>
<style scoped>
.lineage {
  height: 550px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}
.lineage-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 24px;
}
.lineage-filters :deep(.n-select) {
  flex: 1;
  min-width: 180px;
}
.lineage :deep(.vue-flow__node) {
  background: var(--surfaceRaised);
  color: var(--textPrimary);
  border-color: var(--accent);
  border-radius: 9px;
  width: 240px;
  min-height: 54px;
  overflow-wrap: anywhere;
}
.lineage :deep(.vue-flow__node:focus-visible) {
  outline: 3px solid var(--accent);
  outline-offset: 3px;
}
</style>
