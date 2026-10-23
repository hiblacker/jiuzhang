<template>
  <div class="query-toolbar">
    <slot />
    <div v-if="$slots.actions" class="query-toolbar__actions"><slot name="actions" /></div>
  </div>
</template>
<style scoped>
.query-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 64px;
  padding: 12px 14px;
  margin-bottom: 20px;
  background: var(--surfaceInset);
  border: 1px solid var(--border);
  border-radius: 12px;
  flex-wrap: wrap;
}
.query-toolbar :deep(.n-input) {
  width: 280px;
  max-width: 100%;
}
.query-toolbar :deep(.n-select) {
  width: 160px;
}
.query-toolbar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
</style>
