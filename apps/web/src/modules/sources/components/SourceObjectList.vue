<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NEmpty, NInput } from 'naive-ui'
import type { Model } from '@/shared/api/types'

const props = defineProps<{
  objects: Model<'SourceObject'>[]
  objectId: string
}>()
const emit = defineEmits<{ select: [objectId: string] }>()
const { t } = useI18n()
const search = ref('')
const filteredObjects = computed(() => {
  const query = search.value.trim().toLowerCase()
  return query
    ? props.objects.filter((object) => object.name.toLowerCase().includes(query))
    : props.objects
})
</script>
<template>
  <aside class="object-list-panel" :aria-label="t('sources.catalog')">
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
    <ul v-if="filteredObjects.length" class="object-list" :aria-label="t('sources.catalog')">
      <li v-for="object in filteredObjects" :key="object.id" :data-object-item="object.id">
        <NButton
          text
          block
          class="object-entry"
          :class="{ 'is-selected': object.id === objectId }"
          :aria-current="object.id === objectId ? 'true' : undefined"
          :title="object.name"
          @click="emit('select', object.id)"
        >
          {{ object.name }}
        </NButton>
      </li>
    </ul>
    <NEmpty v-else :description="t('empty')" size="small" class="object-empty" />
  </aside>
</template>
<style scoped>
.object-list-panel {
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
.object-list-panel :deep(.n-input) {
  flex-shrink: 0;
}
.object-list {
  flex: 1;
  min-height: 0;
  margin: 16px 0 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}
.object-list li + li {
  margin-top: 2px;
}
.object-entry {
  --n-padding: 7px 12px;
  --n-border-radius: 3px;
  min-height: 36px;
  background: transparent;
  color: var(--textPrimary);
  text-align: left;
}
.object-entry :deep(.n-button__content) {
  display: block;
  width: 100%;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.object-entry:hover {
  background: var(--surface);
}
.object-entry.is-selected {
  background: var(--accentSoft);
  color: var(--accent);
}
.object-entry:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.object-empty {
  flex: 1;
  min-height: 0;
}
</style>
