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
  if (connection.kind === 'database')
    return connection.schema && props.source.settings.schema
      ? [{ key: 'schema', label: props.source.settings.schema, children: objects }]
      : objects
  return [{ key: 'root', label: props.source.name, children: objects }]
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
    <header class="catalog-heading">
      <h2>{{ t('sources.catalog') }}</h2>
      <span>{{ t('sources.tableCount', { count: objects.length }) }}</span>
    </header>
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
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  padding: 20px 16px 20px 20px;
}
.catalog-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 18px;
}
.catalog-heading h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.catalog-heading span {
  color: var(--textSecondary);
  font-size: 12px;
}
.object-tree :deep(.n-input) {
  flex-shrink: 0;
}
.object-tree :deep(.n-tree) {
  flex: 1;
  min-height: 0;
  margin-top: 16px;
  overflow: auto;
}
</style>
