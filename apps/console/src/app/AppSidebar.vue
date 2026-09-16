<script setup lang="ts">
import { Database } from 'lucide-vue-next'
import type { NavigationItem } from './navigation'
defineProps<{ items: NavigationItem[], current: string, expanded: boolean, connected: boolean }>()
defineEmits<{ navigate: [key: string] }>()
</script>

<template>
  <aside class="sidebar" :class="{ expanded }">
    <div class="brand">
      <span class="brand-mark"><Database :size="23" /></span>
      <div><strong>九章</strong><small>JIUZHANG</small></div>
    </div>
    <div class="nav-caption">
      数据工作台
    </div>
    <nav class="app-nav" aria-label="主导航">
      <button
        v-for="item in items"
        :key="item.key"
        :class="{ active: current === item.key }"
        :aria-current="current === item.key ? 'page' : undefined"
        @click="$emit('navigate', item.key)"
      >
        <component :is="item.icon" :size="18" /><span>{{ item.label }}</span>
      </button>
    </nav>
    <div class="sidebar-bottom">
      <span class="connection-dot" :class="{ online: connected }" />{{
        connected ? '控制 API 已连接' : '未连接'
      }}<small>CONSOLE 0.2.1</small>
    </div>
  </aside>
</template>

<style scoped src="./AppSidebar.css" />
