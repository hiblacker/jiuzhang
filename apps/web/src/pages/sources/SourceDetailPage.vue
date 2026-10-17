<script setup lang="ts">
import { vAccessibleTabs } from '@/shared/ui/accessible-tabs'
import { useRouteTab } from '@/shared/composables/use-route-tab'
import { DataPreview } from '@/shared/ui/data-preview'
import { ResponsiveDescriptions } from '@/shared/ui/responsive-descriptions'
const canWrite = useCan('write')
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NButton, NCard, NTag, NTabs, NTabPane, NDescriptionsItem, NAlert } from 'naive-ui'
import { useSource, useSourceObjects, useSourcePreview, SourceObjectTree } from '@/modules/sources'
import { RunHistory } from '@/modules/jobs'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { CopyButton } from '@/shared/ui/copy-button'
import { useCan } from '@/shared/security/permissions'
const { t } = useI18n(),
  route = useRoute(),
  router = useRouter()
const id = computed(() => String(route.params.id))
const source = useSource(id),
  objects = useSourceObjects(id)
const selected = computed(() =>
  typeof route.query.objectId === 'string'
    ? route.query.objectId
    : (objects.data.value?.[0]?.id ?? ''),
)
const selectedObject = computed(() =>
  objects.data.value?.find((object) => object.id === selected.value),
)
const selectedField = computed(() =>
  typeof route.query.field === 'string' ? route.query.field : '',
)
function select(objectId: string, field: string) {
  void router.push({ query: { ...route.query, objectId, field: field || undefined } })
}
const preview = useSourcePreview(id, selected)
const tab = useRouteTab(['catalog', 'preview', 'sync'], 'catalog')
const fields = computed(
  () => objects.data.value?.find((x) => x.id === selected.value)?.fields ?? [],
)
const columns = computed(() => [
  { title: t('field'), key: 'name' },
  { title: t('dataType'), key: 'type' },
  { title: t('description'), key: 'description' },
])
const readonly = computed(() => !canWrite.value)
</script>
<template>
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
    ><NCard :bordered="false" class="mb"
      ><ResponsiveDescriptions :max-columns="4"
        ><NDescriptionsItem label="ID">{{ id }} <CopyButton :value="id" /></NDescriptionsItem
        ><NDescriptionsItem :label="t('type')">{{ source.data.value?.type }}</NDescriptionsItem
        ><NDescriptionsItem :label="t('status')"
          ><NTag type="success" :bordered="false">{{
            t(source.data.value?.status ?? 'connected')
          }}</NTag></NDescriptionsItem
        ><NDescriptionsItem :label="t('owner')">{{
          source.data.value?.owner
        }}</NDescriptionsItem></ResponsiveDescriptions
      ></NCard
    ><NCard :bordered="false"
      ><NTabs v-accessible-tabs="t('sources.details')" :value="tab" @update:value="tab = $event"
        ><NTabPane name="catalog" :tab="t('sources.catalog')"
          ><AsyncState
            :loading="objects.isLoading.value"
            :error="objects.error.value"
            :empty="objects.data.value?.length === 0"
            @retry="objects.refetch()"
            ><div class="catalog-layout">
              <SourceObjectTree
                v-if="source.data.value"
                :source="source.data.value"
                :objects="objects.data.value ?? []"
                :object-id="selected"
                :field="selectedField"
                @select="select"
              />
              <section>
                <NAlert v-if="!selectedObject" type="warning">{{ t('resourceNotFound') }}</NAlert>
                <div v-else class="query-toolbar">
                  <h3>{{ selectedObject.name }}</h3>
                  <NButton
                    secondary
                    type="primary"
                    :disabled="readonly || !selectedObject"
                    @click="
                      router.push({
                        path: '/datasets/new',
                        query: {
                          sourceId: id,
                          objectId: selected,
                          field: selectedField || undefined,
                        },
                      })
                    "
                    >{{ t('sources.fromSource') }}</NButton
                  >
                </div>
                <NAlert v-if="selectedField" type="info" class="mb"
                  >{{ t('sources.selectedField', { field: selectedField }) }}
                  <NButton text @click="select(selected, '')">{{
                    t('sources.allFields')
                  }}</NButton></NAlert
                >
                <h3>{{ t('sources.fields') }}</h3>
                <DataPreview
                  :columns="columns"
                  :rows="
                    (selectedField
                      ? fields.filter((field) => field.name === selectedField)
                      : fields
                    ).map((field) => ({ ...field }))
                  "
                />
              </section></div></AsyncState></NTabPane
        ><NTabPane name="preview" :tab="t('sources.preview')"
          ><AsyncState
            :loading="preview.isLoading.value"
            :error="preview.error.value"
            @retry="preview.refetch()"
            ><NAlert type="info" class="mb">{{ preview.data.value?.notes.join('；') }}</NAlert
            ><DataPreview
              :columns="preview.data.value?.fields.map((field) => field.name) ?? []"
              :rows="preview.data.value?.rows ?? []" /></AsyncState></NTabPane
        ><NTabPane name="sync" :tab="t('sources.sync')"
          ><RunHistory
            :scope="{ sourceId: id }"
            @select="router.push('/runs/' + $event)" /></NTabPane></NTabs></NCard
  ></AsyncState>
</template>
<style scoped>
.catalog-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 24px;
}
@media (max-width: 1000px) {
  .catalog-layout {
    grid-template-columns: 1fr;
  }
}
</style>
