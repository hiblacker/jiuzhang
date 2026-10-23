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
import { ApiErrorMessageBridge } from '@/shared/ui/error-message'
const ui = useUiStore()
const palette = computed(() => (ui.darkMode ? palettes.dark : palettes.light))
const overrides = computed<GlobalThemeOverrides>(() => ({
  common: {
    primaryColor: palette.value.accent,
    primaryColorHover: palette.value.accentHover,
    primaryColorPressed: palette.value.accentPressed,
    bodyColor: palette.value.surface,
    cardColor: palette.value.surfaceRaised,
    baseColor: palette.value.surfaceRaised,
    textColorBase: palette.value.textPrimary,
    textColor1: palette.value.textPrimary,
    textColor2: palette.value.textPrimary,
    textColor3: palette.value.textSecondary,
    placeholderColor: palette.value.textTertiary,
    successColor: palette.value.success,
    warningColor: palette.value.warning,
    errorColor: palette.value.danger,
    borderColor: palette.value.border,
    borderRadius: '9px',
    fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  Layout: {
    color: palette.value.surface,
    headerColor: palette.value.surfaceRaised,
    siderColor: palette.value.surfaceRaised,
  },
  Menu: {
    itemColorActive: palette.value.accentSoft,
    itemColorHover: palette.value.accentTint,
    itemTextColorActive: palette.value.accent,
    itemIconColorActive: palette.value.accent,
    itemHeight: '42px',
    borderRadius: '10px',
  },
  Card: {
    borderRadius: '14px',
    paddingMedium: '22px',
    titleFontSizeMedium: '15px',
    titleFontWeight: '600',
  },
  Button: { borderRadiusMedium: '9px' },
  Input: { borderRadius: '9px' },
  Tag: { borderRadius: '999px' },
  DataTable: {
    thColor: palette.value.surfaceInset,
    thTextColor: palette.value.textSecondary,
    thFontWeight: '600',
    thPaddingMedium: '13px 18px',
    tdPaddingMedium: '15px 18px',
    borderColor: palette.value.border,
    tdColorHover: palette.value.accentTint,
  },
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
      ><NDialogProvider><ApiErrorMessageBridge /><RouterView /></NDialogProvider></NMessageProvider
  ></NConfigProvider>
</template>
