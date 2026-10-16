<script setup lang="ts">
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])
const props = defineProps<{
  points: { date: string; succeeded: number; failed: number }[]
  labels: [string, string]
  label?: string
}>()
const el = ref<HTMLElement>()
let chart: echarts.ECharts | undefined
let observer: ResizeObserver | undefined
let themeObserver: MutationObserver | undefined
function render() {
  const style = getComputedStyle(document.documentElement)
  const color = (name: string) => style.getPropertyValue('--' + name).trim()
  chart?.setOption({
    textStyle: { color: color('textSecondary') },
    tooltip: { trigger: 'axis' },
    grid: { left: 30, right: 20, top: 25, bottom: 25 },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: props.points.map((p) => p.date.slice(5)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: color('textSecondary') },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { color: color('textSecondary') },
      splitLine: { lineStyle: { color: color('border'), type: 'dashed' } },
    },
    series: [
      {
        name: props.labels[0],
        type: 'line',
        smooth: true,
        data: props.points.map((p) => p.succeeded),
        symbolSize: 7,
        lineStyle: { color: color('accent'), width: 3 },
        itemStyle: { color: color('accent') },
        areaStyle: { color: color('accentSoft') },
      },
      {
        name: props.labels[1],
        type: 'line',
        smooth: true,
        data: props.points.map((p) => p.failed),
        symbolSize: 5,
        itemStyle: { color: color('warning') },
      },
    ],
  })
}
onMounted(() => {
  if (el.value) {
    chart = echarts.init(el.value)
    render()
    observer = new ResizeObserver(() => chart?.resize())
    observer.observe(el.value)
    themeObserver = new MutationObserver(render)
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    })
  }
})
watch(() => props.points, render)
onBeforeUnmount(() => {
  observer?.disconnect()
  themeObserver?.disconnect()
  chart?.dispose()
})
</script>
<template>
  <div
    ref="el"
    role="img"
    :aria-label="label ?? uiText('ui.trend_chart_d0f3b516')"
    class="trend-chart"
  />
</template>
<style scoped>
.trend-chart {
  height: 270px;
  width: 100%;
}
</style>
