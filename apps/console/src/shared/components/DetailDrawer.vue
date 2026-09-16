<script setup lang="ts">
import { computed } from 'vue'
import { NDrawer, NDrawerContent, NDescriptions, NDescriptionsItem, NCode } from 'naive-ui'
import { display, object } from '../types'
const props = defineProps<{ title: string, value: unknown, show: boolean }>()
defineEmits<{ 'update:show': [value: boolean] }>()
const flat = computed(() =>
  Object.entries(object(props.value)).filter(([, v]) => v == null || typeof v !== 'object'),
)
</script>
<template>
  <NDrawer :show="show" :width="680" @update:show="$emit('update:show', $event)">
    <NDrawerContent :title="title" closable>
      <NDescriptions
        v-if="flat.length"
        bordered
        :column="1"
        label-placement="left"
      >
        <NDescriptionsItem v-for="[key, item] of flat" :key="key" :label="key">
          {{ display(item) }}
        </NDescriptionsItem>
      </NDescriptions>
      <NCode
        :code="JSON.stringify(value, null, 2)"
        word-wrap
        internal-no-highlight
        class="detail-code"
      />
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped src="./DetailDrawer.css" />
