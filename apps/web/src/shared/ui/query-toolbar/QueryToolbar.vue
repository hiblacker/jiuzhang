<template>
  <div class="query-toolbar"><slot /></div>
</template>
<style scoped>
.query-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 22px;
  flex-wrap: wrap;
}
.query-toolbar :deep(.n-input) {
  max-width: 320px;
}
.query-toolbar :deep(.n-select) {
  width: 160px;
}
</style>
