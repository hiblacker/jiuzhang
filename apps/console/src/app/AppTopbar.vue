<script setup lang="ts">
import { NButton, NTag, NTooltip } from 'naive-ui'
import { LogOut, PanelLeft, PlugZap } from 'lucide-vue-next'
defineProps<{ title: string, mode: string, connected: boolean }>()
defineEmits<{ menu: [], reconnect: [] }>()
</script>

<template>
  <header class="topbar">
    <NButton
      class="menu-toggle"
      quaternary
      circle
      aria-label="打开导航"
      @click="$emit('menu')"
    >
      <PanelLeft :size="19" />
    </NButton>
    <span class="breadcrumb">数据平台 <span>/</span> {{ title }}</span>
    <div class="topbar-actions">
      <NTag :bordered="false" size="small">
        {{ mode === 'admin' ? '平台管理' : '项目成员' }}
      </NTag>
      <NTooltip>
        <template #trigger>
          <NButton
            quaternary
            circle
            aria-label="重新连接"
            @click="$emit('reconnect')"
          >
            <component :is="connected ? LogOut : PlugZap" :size="18" />
          </NButton>
        </template>重新连接
      </NTooltip>
    </div>
  </header>
</template>

<style scoped src="./AppTopbar.css" />
