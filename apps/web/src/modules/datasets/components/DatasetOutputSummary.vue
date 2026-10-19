<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAlert, NDescriptionsItem } from 'naive-ui'
import { ResponsiveDescriptions } from '@/shared/ui/responsive-descriptions'
import type { Model } from '@/shared/api/types'

const real = import.meta.env.VITE_API_MODE === 'real'
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
    <ResponsiveDescriptions :max-columns="2" bordered class="mb">
      <NDescriptionsItem :label="t('datasets.output.mode')">{{ mode.label }}</NDescriptionsItem>
      <NDescriptionsItem :label="t('datasets.output.keys')">{{
        output.keys.join('、') || t('datasets.output.noKeys')
      }}</NDescriptionsItem>
    </ResponsiveDescriptions>
    <NAlert type="info">{{
      real ? t('datasets.realOutput') : mode.description + ' ' + t('datasets.output.boundary')
    }}</NAlert>
  </section>
</template>
