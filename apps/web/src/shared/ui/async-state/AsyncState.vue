<script setup lang="ts">
import { NAlert, NButton, NEmpty, NSkeleton } from 'naive-ui'
import { useI18n } from 'vue-i18n'
defineProps<{ loading?: boolean; error?: unknown; empty?: boolean }>()
defineEmits<{ retry: [] }>()
const { t } = useI18n()
</script>
<template>
  <div v-if="loading" class="loading"><NSkeleton text :repeat="5" /></div>
  <div v-else-if="error" class="error-state">
    <NAlert type="error" :show-icon="false">
      <div class="error-content">
        <span>{{ t('error') }}</span>
        <NButton size="small" secondary @click="$emit('retry')">{{ t('retry') }}</NButton>
      </div>
    </NAlert>
  </div>
  <NEmpty v-else-if="empty" :description="t('empty')" class="empty" /><slot v-else />
</template>
<style scoped>
.loading,
.empty {
  padding: 64px 24px;
}
.error-state {
  padding: 28px 0;
}
.error-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
</style>
