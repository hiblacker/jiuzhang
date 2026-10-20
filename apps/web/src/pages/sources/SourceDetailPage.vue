<script setup lang="ts">
import { DataPreview } from '@/shared/ui/data-preview'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NButton, NCard, NTag, NAlert, NEllipsis, NSplit } from 'naive-ui'
import { useSource, useSourceObjects, SourceObjectTree } from '@/modules/sources'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { CopyButton } from '@/shared/ui/copy-button'
import { useCan } from '@/shared/security/permissions'
const canWrite = useCan('write')
const { t } = useI18n(),
  route = useRoute(),
  router = useRouter()
const id = computed(() => String(route.params.id))
const source = useSource(id),
  objects = useSourceObjects(id)
const catalogSize = ref(0.3)
const selected = computed(() =>
  typeof route.query.objectId === 'string'
    ? route.query.objectId
    : (objects.data.value?.[0]?.id ?? ''),
)
const selectedObject = computed(() =>
  objects.data.value?.find((object) => object.id === selected.value),
)
function select(objectId: string) {
  const query = { ...route.query }
  delete query.field
  query.objectId = objectId
  void router.push({ query })
}
function resizeCatalog(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft') catalogSize.value = Math.max(0.24, catalogSize.value - 0.02)
  else if (event.key === 'ArrowRight') catalogSize.value = Math.min(0.5, catalogSize.value + 0.02)
  else if (event.key === 'Home') catalogSize.value = 0.24
  else if (event.key === 'End') catalogSize.value = 0.5
  else return
  event.preventDefault()
}
const fields = computed(() => selectedObject.value?.fields ?? [])
const columns = computed(() => [
  { title: t('field'), key: 'name', width: 200 },
  { title: t('dataType'), key: 'type', width: 130 },
  { title: t('description'), key: 'description', width: 320 },
])
const readonly = computed(() => !canWrite.value)
</script>
<template>
  <div class="source-detail">
    <PageHeader
      :title="source.data.value?.name ?? t('sources.details')"
      :description="source.data.value?.description"
      ><NButton @click="router.push('/sources')">{{ t('back') }}</NButton
      ><NButton
        type="primary"
        :disabled="readonly"
        @click="router.push('/sources/' + id + '/edit')"
        >{{ t('edit') }}</NButton
      ></PageHeader
    ><AsyncState
      :loading="source.isLoading.value"
      :error="source.error.value"
      @retry="source.refetch()"
    >
      <section class="source-summary" :aria-label="t('sources.basic')">
        <NTag :bordered="false">{{ source.data.value?.type }}</NTag>
        <NTag type="success" :bordered="false">{{
          t(source.data.value?.status ?? 'connected')
        }}</NTag>
        <span class="source-identity"
          ><span class="muted">ID</span><NEllipsis>{{ id }}</NEllipsis
          ><CopyButton :value="id"
        /></span>
        <span class="source-owner"
          ><span class="muted">{{ t('owner') }}</span
          ><NEllipsis
            tabindex="0"
            :tooltip="{
              trigger: 'focus',
              contentStyle: {
                maxWidth: 'min(480px, calc(100vw - 32px))',
                overflowWrap: 'anywhere',
              },
            }"
            >{{ source.data.value?.owner
            }}<template #tooltip
              ><span role="tooltip">{{ source.data.value?.owner }}</span></template
            ></NEllipsis
          ></span
        >
      </section>
      <NCard
        :bordered="false"
        :content-style="{ padding: '0', height: '100%', minHeight: '0' }"
        class="catalog-card"
        ><AsyncState
          :loading="objects.isLoading.value"
          :error="objects.error.value"
          :empty="objects.data.value?.length === 0"
          @retry="objects.refetch()"
          ><NSplit
            v-model:size="catalogSize"
            :min="0.24"
            :max="0.5"
            :resize-trigger-size="12"
            class="catalog-layout"
          >
            <template #1>
              <SourceObjectTree
                v-if="source.data.value"
                :source="source.data.value"
                :objects="objects.data.value ?? []"
                :object-id="selected"
                @select="select"
              />
            </template>
            <template #resize-trigger>
              <div
                class="catalog-resizer"
                role="separator"
                tabindex="0"
                aria-orientation="vertical"
                :aria-label="t('sources.resizeCatalog')"
                :aria-valuenow="Math.round(catalogSize * 100)"
                :aria-valuemin="24"
                :aria-valuemax="50"
                @keydown="resizeCatalog"
              >
                <span />
              </div>
            </template>
            <template #2>
              <section class="schema-panel" :aria-label="t('sources.fields')">
                <NAlert v-if="!selectedObject" type="warning">{{ t('resourceNotFound') }}</NAlert>
                <template v-else>
                  <header class="schema-header">
                    <div class="schema-heading">
                      <div class="schema-table-name">
                        <h2>
                          <NEllipsis>{{ selectedObject.name }}</NEllipsis>
                        </h2>
                        <CopyButton :value="selectedObject.name" />
                      </div>
                      <p>
                        {{ t('sources.fields') }}<span>·</span
                        >{{ t('sources.fieldCount', { count: fields.length }) }}
                      </p>
                    </div>
                    <NButton
                      secondary
                      type="primary"
                      :disabled="readonly"
                      @click="
                        router.push({
                          path: '/datasets/new',
                          query: { sourceId: id, objectId: selected },
                        })
                      "
                      >{{ t('sources.fromSource') }}</NButton
                    >
                  </header>
                  <DataPreview
                    :columns="columns"
                    :rows="fields.map((field) => ({ ...field }))"
                    fill-height
                  />
                </template>
              </section>
            </template> </NSplit></AsyncState></NCard
    ></AsyncState>
  </div>
</template>
<style scoped>
.source-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 680px;
}
.source-detail :deep(.page-header) {
  flex-shrink: 0;
  margin-bottom: 14px;
}
.source-summary {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
  margin-bottom: 20px;
}
.source-identity,
.source-owner {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.source-identity {
  max-width: 45%;
}
.source-owner {
  flex: 1;
}
.source-summary .muted {
  flex-shrink: 0;
}
.catalog-card {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.catalog-layout {
  height: 100%;
}
.catalog-resizer {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  border-left: 1px solid var(--border);
  border-right: 1px solid var(--border);
}
.catalog-resizer span {
  width: 3px;
  height: 32px;
  border-radius: 4px;
  background: var(--border);
}
.catalog-resizer:hover,
.catalog-resizer:focus-visible {
  background: var(--surface);
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.schema-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  padding: 20px;
}
.schema-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}
.schema-heading {
  min-width: 0;
  flex: 1 1 160px;
}
.schema-table-name {
  display: flex;
  align-items: center;
  gap: 6px;
}
.schema-table-name h2 {
  margin: 0;
  min-width: 0;
  font-size: 18px;
  font-weight: 600;
}
.schema-heading p {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--textSecondary);
}
.schema-heading p span {
  padding: 0 8px;
}
.schema-panel :deep(.n-data-table-td) {
  padding-top: 12px;
  padding-bottom: 12px;
}
</style>
