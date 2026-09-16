import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  Activity,
  CalendarClock,
  Database,
  Files,
  ListChecks,
  Users,
  Workflow,
} from 'lucide-vue-next'
import { useSessionStore } from '../stores/session'

export const routes = [
  { key: 'overview', label: '运行概览', icon: Activity, admin: true, project: false },
  { key: 'sources', label: '数据来源', icon: Database, admin: true, project: false },
  { key: 'plans', label: '接入计划', icon: CalendarClock, admin: true, project: false },
  { key: 'runs', label: '执行与交付', icon: ListChecks, admin: true, project: false },
  { key: 'assets', label: '资产目录', icon: Files, admin: false, project: true },
  { key: 'models', label: '模型与数据集', icon: Workflow, admin: false, project: true },
  { key: 'access', label: '项目权限', icon: Users, admin: false, project: true },
]
export type NavigationItem = (typeof routes)[number]

export function useNavigation() {
  const session = useSessionStore()
  const route = ref(window.location.hash.slice(1) || 'overview')
  const mobileMenu = ref(false)
  const visibleRoutes = computed(() =>
    routes.filter(item => !item.admin || session.mode === 'admin'),
  )
  const currentRoute = computed(
    () => visibleRoutes.value.find(item => item.key === route.value) ?? visibleRoutes.value[0]!,
  )
  function navigate(key: string) {
    window.location.hash = key
    route.value = key
    mobileMenu.value = false
  }
  function hashChanged() {
    route.value = window.location.hash.slice(1)
  }
  onMounted(() => window.addEventListener('hashchange', hashChanged))
  onUnmounted(() => window.removeEventListener('hashchange', hashChanged))
  return { currentRoute, visibleRoutes, mobileMenu, navigate }
}
