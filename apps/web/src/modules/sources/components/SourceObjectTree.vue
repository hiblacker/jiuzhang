<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NInput, NTree, type TreeOption } from 'naive-ui'
import type { Model } from '@/shared/api/types'
import { connectorRegistry } from '../model/connectors'
const props = defineProps<{
  source: Model<'Source'>
  objects: Model<'SourceObject'>[]
  objectId: string
}>()
const emit = defineEmits<{ select: [objectId: string] }>()
const { t } = useI18n(),
  search = ref('')
const tree = computed<TreeOption[]>(() => {
  const connection = connectorRegistry[props.source.type]
  const objects: TreeOption[] = props.objects.map((object) => ({
    key: 'object:' + object.id,
    label: object.name,
    objectId: object.id,
  }))
  const children =
    connection.schema && props.source.settings.schema
      ? [{ key: 'schema', label: props.source.settings.schema, children: objects }]
      : objects
  return [
    {
      key: 'root',
      label: connection.kind === 'database' ? props.source.settings.database : props.source.name,
      children,
    },
  ]
})
const selected = computed(() => ['object:' + props.objectId])
const expanded = ref<(string | number)[]>(['root', 'schema'])
watch(
  () => props.source.id + ':' + props.objectId,
  () => {
    expanded.value = ['root', 'schema', 'object:' + props.objectId]
  },
  { immediate: true },
)
function select(_keys: (string | number)[], options: (TreeOption | null)[]) {
  const option = options[0]
  if (option && typeof option.objectId === 'string') emit('select', option.objectId)
}
</script>
<template>
  <aside class="object-tree" :aria-label="t('sources.catalog')">
    <NInput
      v-model:value="search"
      clearable
      :placeholder="t('sources.searchObjects')"
      :input-props="{ 'aria-label': t('sources.searchObjects') }"
    />
    <NTree
      :key="source.id"
      :data="tree"
      :node-props="({ option }) => ({ 'data-object-node': String(option.key) })"
      :pattern="search"
      :show-irrelevant-nodes="false"
      :selected-keys="selected"
      v-model:expanded-keys="expanded"
      block-line
      expand-on-click
      :cancelable="false"
      @update:selected-keys="select"
    />
  </aside>
</template>
<style scoped>
.object-tree {
  min-width: 0;
  padding-right: 20px;
  border-right: 1px solid var(--border);
}
.object-tree :deep(.n-tree) {
  margin-top: 16px;
  max-height: 520px;
  overflow: auto;
}
@media (max-width: 1000px) {
  .object-tree {
    border-right: none;
    padding-right: 0;
  }
}
</style>
