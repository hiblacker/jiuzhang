<script setup lang="ts">
// The shell is deliberately thin: the session, the layout and the pages live in their own
// modules, and the router decides what is rendered.
import { NConfigProvider, dateZhCN, zhCN } from 'naive-ui';
import { RouterView } from 'vue-router';
</script>

<template>
  <n-config-provider :locale="zhCN" :date-locale="dateZhCN">
    <RouterView />
  </n-config-provider>
</template>
