<script setup lang="ts">
import { computed } from 'vue';
import { NDrawer, NDrawerContent, NDescriptions, NDescriptionsItem, NCode } from 'naive-ui';
import { display, object } from '../types';
const props = defineProps<{ title: string; value: unknown; show: boolean }>();
defineEmits<{ 'update:show': [value: boolean] }>();
const flat = computed(() => Object.entries(object(props.value)).filter(([, v]) => v == null || typeof v !== 'object'));
</script>
<template>
  <n-drawer :show="show" :width="680" @update:show="$emit('update:show', $event)">
    <n-drawer-content :title="title" closable>
      <n-descriptions v-if="flat.length" bordered :column="1" label-placement="left">
        <n-descriptions-item v-for="[key, value] of flat" :key="key" :label="key">{{
          display(value)
        }}</n-descriptions-item>
      </n-descriptions>
      <n-code :code="JSON.stringify(value, null, 2)" word-wrap internal-no-highlight class="detail-code" />
    </n-drawer-content>
  </n-drawer>
</template>
