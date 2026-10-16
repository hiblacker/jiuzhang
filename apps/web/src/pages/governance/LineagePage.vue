<script setup lang="ts">
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

import { computed, ref, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { NCard, NButton, NSelect, NAlert, NDescriptions, NDescriptionsItem } from 'naive-ui'
import { useLineage, lineageScope } from '@/modules/governance'
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
const nodes = computed(() => {
  const count: Record<string, number> = {}
  return (query.data.value?.nodes ?? [])
    .filter((n) => !visibleIds.value || visibleIds.value.has(n.id))
    .map((n) => {
      const row = count[n.kind] ?? 0
      count[n.kind] = row + 1
      return {
        id: n.id,
        position: { x: { source: 0, dataset: 320, table: 640 }[n.kind] ?? 0, y: row * 90 },
        data: { label: n.label },
        type:
          ({ source: 'input', table: 'output', dataset: 'default' } as Record<string, string>)[
            n.kind
          ] ?? 'default',
      }
    })
})
const edges = computed(
  () =>
    query.data.value?.edges.filter(
      (e) =>
        nodes.value.some((n) => n.id === e.source) && nodes.value.some((n) => n.id === e.target),
    ) ?? [],
)
const detail = computed(() => query.data.value?.nodes.find((n) => n.id === focused.value))
watch(nodes, async () => {
  await nextTick()
  await flow.fitView()
})
</script>
<template>
  <PageHeader :title="uiText('ui.lineage_daa9947a')" :description="uiText('ui.lineage_21ea5894')"
    ><NButton @click="flow.fitView()">{{ uiText('ui.lineage_3bc70c8d') }}</NButton
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
        :aria-label="uiText('lineage.scope')"
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
        :aria-label="uiText('lineage.selected')"
        :placeholder="uiText('ui.lineage_9b907c0c')"
        :options="resources.data.value?.nodes.map((n) => ({ value: n.id, label: n.label }))"
        @update:value="filter({ resource: $event, field: null })"
      />
      <NSelect
        :value="direction"
        :aria-label="uiText('lineage.direction')"
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
        :aria-label="uiText('lineage.selectedField')"
        :placeholder="uiText('lineage.selectedField')"
        @update:value="filter({ field: $event })"
      />
    </div>
    <AsyncState
      :loading="query.isLoading.value"
      :error="query.error.value"
      :empty="query.data.value && !nodes.length"
      @retry="query.refetch()"
      ><div class="lineage">
        <VueFlow
          :nodes="nodes"
          :edges="edges"
          :nodes-draggable="false"
          :nodes-connectable="false"
          :delete-key-code="null"
          fit-view-on-init
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
}
</style>
