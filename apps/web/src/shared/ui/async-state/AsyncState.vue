<script setup lang="ts">
import { NButton, NEmpty, NSkeleton } from 'naive-ui'
import { useI18n } from 'vue-i18n'
defineProps<{ loading?: boolean; error?: unknown; empty?: boolean }>()
defineEmits<{ retry: [] }>()
const { t } = useI18n()
</script>
<template>
  <div v-if="loading" class="loading"><NSkeleton text :repeat="5" /></div>
  <div v-else-if="error" class="error-state">
    <NButton size="small" @click="$emit('retry')">{{ t('retry') }}</NButton>
  </div>
  <NEmpty v-else-if="empty" :description="t('empty')" class="empty" /><slot v-else />
</template>
<style scoped>
.loading,
.empty {
  padding: 50px 24px;
}
.error-state {
  display: flex;
  justify-content: center;
  padding: 50px 24px;
}
</style>
