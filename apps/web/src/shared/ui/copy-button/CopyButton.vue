<script setup lang="ts">
import { NButton, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
defineProps<{ value: string }>()
const { t } = useI18n()
const message = useMessage()
async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    message.success(t('copied'))
  } catch {
    message.error(t('copyFailed'))
  }
}
</script>
<template>
  <NButton size="tiny" quaternary @click="copy(value)">{{ t('copy') }}</NButton>
</template>
