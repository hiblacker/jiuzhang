<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { NDescriptions } from 'naive-ui'

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{ maxColumns?: 1 | 2 | 3 | 4 }>(), { maxColumns: 3 })
const container = ref<HTMLElement>()
const width = ref(0)
const columns = computed(() =>
  Math.min(props.maxColumns, Math.max(1, Math.floor(width.value / 280))),
)
let observer: ResizeObserver | undefined
onMounted(() => {
  if (!container.value) return
  width.value = container.value.clientWidth
  observer = new ResizeObserver(([entry]) => {
    if (entry) width.value = entry.contentRect.width
  })
  observer.observe(container.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div ref="container" class="responsive-descriptions">
    <NDescriptions v-bind="$attrs" :column="columns"><slot /></NDescriptions>
  </div>
</template>

<style scoped>
.responsive-descriptions {
  width: 100%;
  min-width: 0;
}
.responsive-descriptions :deep(.n-descriptions-table) {
  width: 100%;
  table-layout: fixed;
}
.responsive-descriptions :deep(.n-descriptions-table-content),
.responsive-descriptions :deep(.n-descriptions-table-header) {
  overflow-wrap: anywhere;
}
</style>
