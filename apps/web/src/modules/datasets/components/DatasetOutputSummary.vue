<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAlert, NDescriptions, NDescriptionsItem } from 'naive-ui'
import type { Model } from '@/shared/api/types'

const props = defineProps<{ output: Model<'Output'> }>()
const { t } = useI18n()
const mode = computed(() => {
  switch (props.output.writeMode) {
    case 'append':
      return { label: t('datasets.output.append'), description: t('datasets.output.appendHelp') }
    case 'replace':
      return { label: t('datasets.output.replace'), description: t('datasets.output.replaceHelp') }
    case 'upsert':
      return { label: t('datasets.output.upsert'), description: t('datasets.output.upsertHelp') }
  }
})
</script>
<template>
  <section :aria-label="t('datasets.output.summary')">
    <NDescriptions :column="2" bordered class="mb">
      <NDescriptionsItem :label="t('datasets.output.mode')">{{ mode.label }}</NDescriptionsItem>
      <NDescriptionsItem :label="t('datasets.output.keys')">{{
        output.keys.join('、') || t('datasets.output.noKeys')
      }}</NDescriptionsItem>
    </NDescriptions>
    <NAlert type="info">{{ mode.description }} {{ t('datasets.output.boundary') }}</NAlert>
  </section>
</template>
