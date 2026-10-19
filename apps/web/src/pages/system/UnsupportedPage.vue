<script setup lang="ts">
import { NButton, NResult } from 'naive-ui'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
const router = useRouter()
const { t } = useI18n()
</script>
<template>
  <NResult
    status="info"
    :title="t('identity.unsupportedTitle')"
    :description="t('identity.unsupportedDescription')"
  >
    <template #footer
      ><NButton @click="router.push('/overview')">{{
        t('identity.backOverview')
      }}</NButton></template
    >
  </NResult>
</template>
