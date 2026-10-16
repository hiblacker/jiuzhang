<script setup lang="ts">
import { computed, watchEffect } from 'vue'
import { RouterView } from 'vue-router'
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  darkTheme,
  zhCN,
  dateZhCN,
  type GlobalThemeOverrides,
} from 'naive-ui'
import { useUiStore } from './stores'
import { palettes } from '@/shared/theme/tokens'
const ui = useUiStore()
const palette = computed(() => (ui.darkMode ? palettes.dark : palettes.light))
const overrides = computed<GlobalThemeOverrides>(() => ({
  common: {
    primaryColor: palette.value.accent,
    primaryColorHover: palette.value.accent,
    primaryColorPressed: palette.value.accent,
    bodyColor: palette.value.surface,
    cardColor: palette.value.surfaceRaised,
    baseColor: palette.value.surfaceRaised,
    textColorBase: palette.value.textPrimary,
    borderColor: palette.value.border,
    borderRadius: '10px',
    fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  Layout: { color: palette.value.surfaceRaised },
  Menu: {
    itemColorActive: palette.value.accentSoft,
    itemTextColorActive: palette.value.accent,
    itemIconColorActive: palette.value.accent,
  },
  Card: { borderRadius: '12px' },
}))
watchEffect(() => {
  for (const [key, value] of Object.entries(palette.value))
    document.documentElement.style.setProperty('--' + key, value)
  document.documentElement.style.colorScheme = ui.darkMode ? 'dark' : 'light'
})
</script>
<template>
  <NConfigProvider
    :theme="ui.darkMode ? darkTheme : null"
    :theme-overrides="overrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
    ><NMessageProvider
      ><NDialogProvider><RouterView /></NDialogProvider></NMessageProvider
  ></NConfigProvider>
</template>
