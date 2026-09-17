<script setup lang="ts">
import { computed } from 'vue';

// One place that renders a JSON payload, so colour, wrapping and scroll behaviour stay identical
// across pages. Strings are shown as-is (used for the ready-made request examples).
const props = defineProps<{ value: unknown }>();
const text = computed(() => (typeof props.value === 'string' ? props.value : JSON.stringify(props.value, null, 2)));
</script>

<template>
  <pre class="json-detail">{{ text }}</pre>
</template>
