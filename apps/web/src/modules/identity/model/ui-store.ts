import { defineStore } from 'pinia'
import { ref } from 'vue'
import { readPreference, writePreference } from '@/shared/lib/preferences'
export const useUiStore = defineStore('ui', () => {
  const collapsed = ref(false)
  const darkMode = ref(readPreference('theme', 'light') === 'dark')
  function toggleDarkMode() {
    darkMode.value = !darkMode.value
    writePreference('theme', darkMode.value ? 'dark' : 'light')
  }
  return { collapsed, darkMode, toggleDarkMode }
})
