<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { errorKey } from '@/shared/api/error-message'
import { uiErrorMessageEvent } from './notify'

const message = useMessage()
const { t } = useI18n()

function showError(event: Event) {
  const error = (event as CustomEvent<unknown>).detail
  message.error(typeof error === 'string' ? error : t(errorKey(error)))
}

onMounted(() => window.addEventListener(uiErrorMessageEvent, showError))
onBeforeUnmount(() => window.removeEventListener(uiErrorMessageEvent, showError))
</script>

<template><span hidden aria-hidden="true" /></template>
