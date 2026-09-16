import { defineStore } from 'pinia'
import type { Project } from '../shared/types.ts'

export const useProjectStore = defineStore('project', {
  state: () => ({
    projects: [] as Project[],
    projectId: null as number | null,
    generation: 0,
  }),
  getters: {
    project: state => state.projects.find(item => item.id === state.projectId),
    owner(): boolean {
      return this.project?.role === 'OWNER'
    },
    engineer(): boolean {
      return ['OWNER', 'ENGINEER'].includes(this.project?.role ?? '')
    },
  },
  actions: {
    reset() {
      this.generation++
      this.projects = []
      this.projectId = null
    },
    replace(projects: Project[]) {
      const previousRole = this.project?.role
      this.projects = projects
      if (!projects.some(item => item.id === this.projectId)) {
        this.select(projects[0]?.id ?? null)
      }
      else if (previousRole !== this.project?.role) {
        this.generation++
      }
    },
    select(id: number | null) {
      if (id !== null && !this.projects.some(item => item.id === id)) {
        throw new Error('项目不在当前授权范围内')
      }
      if (id !== this.projectId) {
        this.generation++
        this.projectId = id
      }
    },
  },
})
