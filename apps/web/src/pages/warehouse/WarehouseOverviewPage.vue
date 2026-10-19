<script setup lang="ts">
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

import { computed, defineAsyncComponent } from 'vue'
import { useRouter } from 'vue-router'
import {
  NCard,
  NButton,
  NStatistic,
  NGrid,
  NGridItem,
  NProgress,
  NAlert,
  NDataTable,
} from 'naive-ui'
import { useWarehouseMetrics } from '@/modules/warehouse'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
const router = useRouter()
const real = import.meta.env.VITE_API_MODE === 'real'
const metrics = useWarehouseMetrics()
const TrendChart = defineAsyncComponent(() => import('@/shared/charts/TrendChart.vue'))
const trend = computed(
  () =>
    metrics.data.value?.trend.map((point) => ({
      date: point.date,
      succeeded: point.reads,
      failed: point.writes,
    })) ?? [],
)
const layers = computed(() => metrics.data.value?.layers ?? [])
</script>
<template>
  <PageHeader
    :title="uiText('ui.warehouse_overview_ce379057')"
    :description="uiText('ui.warehouse_overview_96d7bc79')"
    ><NButton v-if="!real" @click="router.push('/warehouse/imports')">{{
      uiText('ui.warehouse_overview_5e1024da')
    }}</NButton
    ><NButton type="primary" @click="router.push('/warehouse/query')">{{
      uiText('ui.warehouse_overview_5ecc0135')
    }}</NButton></PageHeader
  ><AsyncState
    :loading="metrics.isLoading.value"
    :error="metrics.error.value"
    @retry="metrics.refetch()"
    ><NGrid cols="1 s:2 l:4" responsive="screen" :x-gap="20" :y-gap="20"
      ><NGridItem v-for="layer in layers" :key="layer.layer"
        ><NCard :bordered="false"
          ><NStatistic
            :label="layer.layer + uiText('ui.warehouse_overview_801b3fa1')"
            :value="layer.tableCount"
          />
          <p class="muted">{{ layer.rowCount }}{{ uiText('ui.warehouse_overview_1b7a27d9') }}</p>
          <NButton
            text
            type="primary"
            @click="router.push('/warehouse/tables?layer=' + layer.layer)"
            >{{ uiText('ui.warehouse_overview_44d4c5bc') }}</NButton
          ></NCard
        ></NGridItem
      ></NGrid
    ><NCard
      :title="uiText('ui.warehouse_overview_e24230d0')"
      :bordered="false"
      style="margin-top: 24px"
      ><div v-for="layer in layers" :key="layer.layer" class="layer">
        <strong>{{ layer.layer }}</strong
        ><NProgress
          type="line"
          :percentage="Math.round((layer.tableCount / (metrics.data.value?.tableCount || 1)) * 100)"
          :height="10"
        /></div></NCard
    ><NCard :title="uiText('warehouse.stats')" :bordered="false" style="margin-top: 24px">
      <NGrid cols="1 s:2 m:4" responsive="screen" :x-gap="20" :y-gap="20">
        <NGridItem
          ><NStatistic
            :label="uiText('warehouse.reads')"
            :value="metrics.data.value?.queryCount ?? 0"
        /></NGridItem>
        <NGridItem
          ><NStatistic
            :label="uiText('warehouse.writes')"
            :value="metrics.data.value?.writeCount ?? 0"
        /></NGridItem>
        <NGridItem
          ><NStatistic
            :label="uiText('warehouse.storage')"
            :value="real ? '—' : ((metrics.data.value?.sampleBytes ?? 0) / 1024).toFixed(1)"
        /></NGridItem>
        <NGridItem
          ><NStatistic
            :label="uiText('warehouse.activeRuns')"
            :value="metrics.data.value?.activeRuns ?? 0"
        /></NGridItem>
      </NGrid>
      <h3 v-if="!real">{{ uiText('warehouse.readWriteTrend') }}</h3>
      <TrendChart
        v-if="!real"
        :points="trend"
        :labels="[uiText('warehouse.reads'), uiText('warehouse.writes')]"
        :label="uiText('warehouse.readWriteTrend')"
      />
      <h3 v-if="!real">{{ uiText('warehouse.tableGrowth') }}</h3>
      <NDataTable
        v-if="!real"
        :data="metrics.data.value?.trend ?? []"
        :columns="[
          { title: uiText('updated'), key: 'date' },
          { title: uiText('overview.tables'), key: 'tables' },
        ]"
        :bordered="false"
      />
      <NAlert type="info">{{
        uiText(real ? 'warehouse.realMetricsHint' : 'warehouse.metricsHint')
      }}</NAlert> </NCard
    ><NAlert type="info" style="margin-top: 24px">{{
      uiText('ui.warehouse_overview_b21e6749')
    }}</NAlert></AsyncState
  >
</template>
<style scoped>
.layer {
  display: grid;
  grid-template-columns: 80px 1fr;
  align-items: center;
  gap: 20px;
  margin: 24px 0;
}
</style>
