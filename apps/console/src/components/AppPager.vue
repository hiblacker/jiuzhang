<script setup lang="ts">
import { NPagination } from 'naive-ui';

// The list pages all page the same way; this keeps the page size and spacing in one place.
const page = defineModel<number>('page', { required: true });
const props = withDefaults(defineProps<{ itemCount: number; pageSize?: number }>(), { pageSize: 25 });
</script>

<template>
  <n-pagination v-model:page="page" :item-count="props.itemCount" :page-size="props.pageSize" class="gap" />
</template>
