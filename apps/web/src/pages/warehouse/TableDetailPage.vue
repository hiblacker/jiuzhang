<script setup lang="ts">
import { vAccessibleTabs } from '@/shared/ui/accessible-tabs'
import { useRouteTab } from '@/shared/composables/use-route-tab'
import { DataPreview } from '@/shared/ui/data-preview'
import { useI18n as useUiI18n } from 'vue-i18n'
import { useCan } from '@/shared/security/permissions'
const canReadSensitive = useCan('readSensitive')
const { t: uiText } = useUiI18n()

import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NCard,
  NButton,
  NTabs,
  NTabPane,
  NDescriptions,
  NDescriptionsItem,
  NTag,
  NAlert,
} from 'naive-ui'
import { useTable, useWarehouseMetrics } from '@/modules/warehouse'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
const route = useRoute(),
  router = useRouter(),
  id = computed(() => String(route.params.id)),
  query = useTable(id),
  metrics = useWarehouseMetrics(id),
  tab = useRouteTab(['schema', 'sample', 'partitions', 'source', 'lineage', 'stats'], 'schema')
</script>
<template>
  <PageHeader
    :title="query.data.value?.name ?? uiText('ui.table_detail_0eae963f')"
    :description="query.data.value?.description"
    ><NButton @click="router.push('/warehouse/tables')">{{
      uiText('ui.table_detail_53505b1f')
    }}</NButton
    ><NButton
      type="primary"
      @click="router.push({ path: '/warehouse/query', query: { tableId: id } })"
      >{{ uiText('ui.table_detail_53b16d23') }}</NButton
    ></PageHeader
  ><AsyncState :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch()"
    ><NAlert v-if="!canReadSensitive" type="info" class="mb">{{
      uiText('warehouse.restrictedColumns')
    }}</NAlert
    ><NCard :bordered="false" class="mb"
      ><NDescriptions :column="4"
        ><NDescriptionsItem :label="uiText('ui.table_detail_752b56a4')">{{
          query.data.value?.layer
        }}</NDescriptionsItem
        ><NDescriptionsItem :label="uiText('ui.table_detail_579f280b')">{{
          query.data.value?.rowCount
        }}</NDescriptionsItem
        ><NDescriptionsItem :label="uiText('ui.table_detail_02c3d613')"
          >v{{ query.data.value?.version }}</NDescriptionsItem
        ><NDescriptionsItem :label="uiText('ui.table_detail_efa08893')"
          ><NButton
            v-if="query.data.value?.datasetId"
            text
            type="primary"
            @click="
              router.push(
                '/datasets/' +
                  query.data.value.datasetId +
                  '/versions/' +
                  query.data.value.datasetVersion,
              )
            "
            >v{{ query.data.value.datasetVersion }}</NButton
          ><span v-else>{{ uiText('warehouse.noDatasetVersion') }}</span></NDescriptionsItem
        ></NDescriptions
      ></NCard
    ><NCard :bordered="false"
      ><NTabs
        v-accessible-tabs="uiText('ui.table_detail_0eae963f')"
        :value="tab"
        @update:value="tab = $event"
        ><NTabPane name="schema" :tab="uiText('ui.table_detail_c6e4459c')"
          ><DataPreview
            :rows="query.data.value?.fields.map((field) => ({ ...field })) ?? []"
            :columns="[
              { title: uiText('ui.table_detail_8e321432'), key: 'name' },
              { title: uiText('ui.table_detail_adf908d5'), key: 'target' },
              { title: uiText('ui.table_detail_e4e46c72'), key: 'type' },
              { title: uiText('ui.table_detail_26670dda'), key: 'description' },
            ]" /></NTabPane
        ><NTabPane name="sample" :tab="uiText('ui.table_detail_cb9dec6e')"
          ><NAlert type="info" class="mb">{{ uiText('ui.table_detail_58436a15') }}</NAlert
          ><DataPreview
            :rows="query.data.value?.sample ?? []"
            :columns="query.data.value?.fields.map((field) => field.target) ?? []" /></NTabPane
        ><NTabPane name="partitions" :tab="uiText('ui.table_detail_223f9140')"
          ><NTag v-for="partition in query.data.value?.partitions" :key="partition">{{
            partition
          }}</NTag></NTabPane
        ><NTabPane name="source" :tab="uiText('ui.table_detail_9b04326b')"
          ><NDescriptions :column="1"
            ><NDescriptionsItem :label="uiText('warehouse.subjectDomain')">{{
              query.data.value?.subjectDomain || uiText('warehouse.unclassified')
            }}</NDescriptionsItem
            ><NDescriptionsItem :label="uiText('ui.table_detail_8eec9f82')"
              ><NButton
                v-if="query.data.value?.datasetId"
                text
                type="primary"
                @click="
                  router.push(
                    '/datasets/' +
                      query.data.value.datasetId +
                      '/versions/' +
                      query.data.value.datasetVersion,
                  )
                "
                >{{ query.data.value.datasetId }} · v{{ query.data.value.datasetVersion }}</NButton
              ><span v-else>{{ uiText('ui.table_detail_460dd9bc') }}</span></NDescriptionsItem
            ><NDescriptionsItem :label="uiText('ui.table_detail_7a0afb42')"
              ><NButton
                v-if="query.data.value?.sourceId"
                text
                type="primary"
                @click="router.push('/sources/' + query.data.value.sourceId)"
                >{{ query.data.value.sourceId }}</NButton
              ><span v-else>—</span></NDescriptionsItem
            ><NDescriptionsItem :label="uiText('ui.table_detail_b499ab6a')">{{
              query.data.value?.updatedAt
            }}</NDescriptionsItem></NDescriptions
          ></NTabPane
        ><NTabPane name="stats" :tab="uiText('ui.table_detail_d194d5e1')"
          ><AsyncState
            :loading="metrics.isLoading.value"
            :error="metrics.error.value"
            @retry="metrics.refetch()"
            ><NDescriptions :column="2" bordered class="mb"
              ><NDescriptionsItem :label="uiText('warehouse.reads')">{{
                metrics.data.value?.queryCount
              }}</NDescriptionsItem
              ><NDescriptionsItem :label="uiText('warehouse.writes')">{{
                metrics.data.value?.writeCount
              }}</NDescriptionsItem
              ><NDescriptionsItem :label="uiText('warehouse.readRows')">{{
                metrics.data.value?.readRows
              }}</NDescriptionsItem
              ><NDescriptionsItem :label="uiText('warehouse.writtenRows')">{{
                metrics.data.value?.writtenRows
              }}</NDescriptionsItem></NDescriptions
            ><NAlert type="info" class="mb">{{
              uiText('warehouse.metricsHint')
            }}</NAlert></AsyncState
          ><NAlert type="info"
            >{{ uiText('ui.table_detail_25e74dce') }}{{ query.data.value?.rowCount
            }}{{ uiText('ui.table_detail_f98bc399') }}{{ query.data.value?.sample.length
            }}{{ uiText('ui.table_detail_80a95ee4') }}</NAlert
          ></NTabPane
        ></NTabs
      ></NCard
    ></AsyncState
  >
</template>
