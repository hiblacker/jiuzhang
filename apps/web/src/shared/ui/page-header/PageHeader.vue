<script setup lang="ts">
defineProps<{ title: string; description?: string }>()
</script>
<template>
  <header class="page-header">
    <div class="page-heading">
      <div class="page-title-row">
        <h1 tabindex="-1">{{ title }}</h1>
        <div v-if="$slots['title-meta']" class="page-title-meta"><slot name="title-meta" /></div>
      </div>
      <p v-if="description">{{ description }}</p>
    </div>
    <div class="page-actions"><slot /></div>
  </header>
</template>
<style scoped>
.page-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 28px;
}
.page-heading {
  flex: 1 1 240px;
  min-width: 0;
}
.page-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin-bottom: 7px;
}
.page-title-row h1 {
  font-size: 26px;
  font-weight: 650;
  letter-spacing: -0.6px;
  margin: 0;
  overflow-wrap: anywhere;
}
.page-title-meta {
  flex: 1 1 400px;
  min-width: 0;
}
.page-header p {
  margin: 0;
  color: var(--textSecondary);
  font-size: 13px;
}
.page-actions {
  display: flex;
  flex-wrap: wrap;
  max-width: 100%;
  gap: 10px;
  align-items: center;
}
</style>
