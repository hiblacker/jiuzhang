<script setup lang="ts">
import { NResult, NButton } from 'naive-ui'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
const router = useRouter(),
  { t } = useI18n()
</script>
<template>
  <NResult
    status="info"
    :title="t('notReady')"
    :description="t('notReadyDescription')"
    style="padding: 100px 0"
    ><template #footer
      ><NButton @click="router.push('/sources')">{{ t('nav.sources') }}</NButton></template
    ></NResult
  >
</template>
