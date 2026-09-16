import { defineStore } from 'pinia'

export type AccessMode = 'admin' | 'project'

export const useSessionStore = defineStore('session', {
  state: () => ({
    base: '',
    mode: 'admin' as AccessMode,
    connected: false,
    connecting: false,
    generation: 0,
  }),
  actions: {
    invalidate() {
      this.generation++
      this.connected = false
      this.connecting = false
    },
    begin(base: string, mode: AccessMode) {
      this.base = base
      this.mode = mode
      this.connecting = true
    },
    complete() {
      this.connecting = false
      this.connected = true
    },
  },
})
