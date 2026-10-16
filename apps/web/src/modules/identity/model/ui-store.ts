import { defineStore } from 'pinia'
import { ref } from 'vue'
import { readPreference, writePreference } from '@/shared/lib/preferences'
export const useUiStore = defineStore('ui', () => {
  const collapsed = ref(false)
  const darkMode = ref(readPreference('theme', 'light') === 'dark')
  const role = ref(readPreference('role', 'developer'))
  const userId = ref(readPreference('user', ''))
  const loggedIn = ref(readPreference('session', '') === 'demo')
  function setRole(value: string) {
    if (value !== role.value) setUser('')
    role.value = value
    writePreference('role', value)
  }
  function setUser(value: string) {
    userId.value = value
    writePreference('user', value)
  }
  function toggleDarkMode() {
    darkMode.value = !darkMode.value
    writePreference('theme', darkMode.value ? 'dark' : 'light')
  }
  function login() {
    loggedIn.value = true
    writePreference('session', 'demo')
  }
  function logout() {
    loggedIn.value = false
    writePreference('session', '')
  }
  return {
    collapsed,
    darkMode,
    role,
    userId,
    loggedIn,
    setRole,
    setUser,
    toggleDarkMode,
    login,
    logout,
  }
})
