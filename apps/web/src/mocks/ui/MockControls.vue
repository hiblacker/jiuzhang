<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  NConfigProvider,
  NButton,
  NSelect,
  NCard,
  NPopconfirm,
  NSpace,
  NText,
  darkTheme,
  zhCN,
  createDiscreteApi,
} from 'naive-ui'

import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import { api, unwrap } from '@/shared/api/client'
import { tickDemoClock } from '../demo-clock'
import type { Model } from '@/shared/api/types'
const props = defineProps<{ onClockChange?: (clock: Model<'DemoClock'>) => void }>()
const { message } = createDiscreteApi(['message'])
const darkMode = ref(false)
let themeObserver: MutationObserver | undefined
const syncTheme = () => {
  darkMode.value = document.documentElement.style.colorScheme === 'dark'
}
const open = ref(false),
  scenario = ref<Model<'Control'>['scenario']>('normal'),
  domain = ref<Model<'Control'>['domain']>('sources'),
  pending = ref(false),
  clock = ref<Model<'DemoClock'> | null>(null)
const scenarios = [
  { label: '正常', value: 'normal' },
  { label: '空列表', value: 'empty' },
  { label: '接口失败', value: 'error' },
  { label: '慢响应', value: 'slow' },
  { label: '无权限', value: 'forbidden' },
]
async function apply() {
  if (pending.value) return
  pending.value = true
  try {
    unwrap(
      await api.PATCH('/demo/control', {
        body: { domain: domain.value, scenario: scenario.value },
      }),
    )
    location.reload()
  } catch {
    message.error('场景设置失败')
    pending.value = false
  }
}
async function reset() {
  if (pending.value) return
  pending.value = true
  try {
    unwrap(await api.POST('/demo/reset'))
    location.reload()
  } catch {
    message.error('重置失败')
    pending.value = false
  }
}
async function advance(seconds: number) {
  if (pending.value) return
  pending.value = true
  const result = await tickDemoClock(seconds)
  if (result) {
    clock.value = result
    props.onClockChange?.(result)
  } else message.error('演示时间推进失败，请稍后重试')
  pending.value = false
}
const onDemoClockEvent = (event: Event) => {
  clock.value = (event as CustomEvent<Model<'DemoClock'>>).detail
}
onMounted(() => {
  syncTheme()
  themeObserver = new MutationObserver(syncTheme)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
  window.addEventListener('demo-clock-change', onDemoClockEvent)
  void advance(0)
})
onBeforeUnmount(() => {
  themeObserver?.disconnect()
  window.removeEventListener('demo-clock-change', onDemoClockEvent)
})
</script>
<template>
  <NConfigProvider :theme="darkMode ? darkTheme : null" :locale="zhCN"
    ><aside class="demo-controls">
      <NButton
        size="small"
        secondary
        :aria-expanded="open"
        aria-controls="demo-control-panel"
        @click="open = !open"
        >演示控制台</NButton
      ><NCard v-if="open" id="demo-control-panel" title="Mock 场景" class="demo-panel"
        ><NText depth="3" class="clock-label">演示时间</NText>
        <div class="clock-value">{{ clock?.now ?? '读取中…' }}</div>
        <NSpace :size="8" class="clock-actions"
          ><NButton size="small" :loading="pending" @click="advance(10)">推进 10 秒</NButton
          ><NButton size="small" :loading="pending" @click="advance(60)"
            >推进 60 秒</NButton
          ></NSpace
        ><NText depth="3" class="clock-help"
          >浏览器前台会自动推进；暂停任务不会派发，错过的计划时刻会跳过，失败重试固定延迟 5
          秒。</NText
        ><NSelect
          v-model:value="domain"
          v-select-trigger-name="'场景作用域'"
          :disabled="pending"
          :options="
            [
              'sources',
              'datasets',
              'tasks',
              'runs',
              'warehouse',
              'governance',
              'services',
              'system',
              'overview',
              'all',
            ].map((value) => ({ value, label: value }))
          "
        /><NSelect
          v-model:value="scenario"
          v-select-trigger-name="'演示场景'"
          :disabled="pending"
          :options="scenarios"
          style="margin: 12px 0"
        /><NButton block type="primary" :loading="pending" @click="apply">应用场景并刷新</NButton
        ><NPopconfirm @positive-click="reset"
          ><template #trigger
            ><NButton block quaternary :disabled="pending" style="margin-top: 8px"
              >重置全部演示数据</NButton
            ></template
          >将清除本地新增内容并恢复合成样本，确定重置？</NPopconfirm
        >
      </NCard>
    </aside></NConfigProvider
  >
</template>
<style scoped>
.demo-controls {
  color: var(--textPrimary);
  position: fixed;
  right: 26px;
  bottom: 18px;
  z-index: 1000;
}
.demo-controls :deep(.n-button) {
  color: var(--textPrimary);
  background: var(--surfaceRaised);
  border: 1px solid var(--border);
}
.demo-panel {
  color: var(--textPrimary);
  background: var(--surfaceRaised);
}
.demo-panel {
  position: absolute;
  bottom: 40px;
  right: 0;
  width: 280px;
}
.clock-label,
.clock-help {
  display: block;
}
.clock-value {
  margin: 4px 0 8px;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}
.clock-actions {
  margin-bottom: 8px;
}
.clock-help {
  margin-bottom: 12px;
  line-height: 1.5;
}
</style>
