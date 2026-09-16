<script setup lang="ts">
import { NConfigProvider, NMessageProvider, NDialogProvider, zhCN, dateZhCN } from 'naive-ui'
import AppShell from './app/AppShell.vue'

const theme = {
  common: {
    primaryColor: '#167d65',
    primaryColorHover: '#116d58',
    primaryColorPressed: '#0b5947',
    borderRadius: '4px',
    fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif',
  },
}
</script>

<template>
  <NConfigProvider :locale="zhCN" :date-locale="dateZhCN" :theme-overrides="theme">
    <NMessageProvider>
      <NDialogProvider><AppShell /></NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
