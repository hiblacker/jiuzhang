<script setup lang="ts">
import { NModal, NButton, NSpace } from 'naive-ui'
import { useI18n } from 'vue-i18n'
defineProps<{
  show: boolean
  title: string
  description: string
  pending: boolean
  confirmText?: string
  destructive?: boolean
  disabled?: boolean
}>()
defineEmits<{ confirm: []; cancel: [] }>()
const { t } = useI18n()
</script>
<template>
  <NModal
    :show="show"
    preset="card"
    :title="title"
    style="width: min(440px, calc(100vw - 32px))"
    :mask-closable="!pending"
    :close-on-esc="!pending"
    :closable="!pending"
    @close="$emit('cancel')"
    @update:show="!$event && !pending && $emit('cancel')"
    ><p>{{ description }}</p>
    <template #footer
      ><NSpace justify="end"
        ><NButton autofocus :disabled="pending" @click="$emit('cancel')">{{ t('cancel') }}</NButton
        ><NButton
          :type="destructive === false ? 'primary' : 'error'"
          :loading="pending"
          :disabled="pending || disabled"
          @click="$emit('confirm')"
          >{{ confirmText ?? t('delete') }}</NButton
        ></NSpace
      ></template
    ></NModal
  >
</template>
