<script setup lang="ts">
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

import { computed, h, provide, ref } from 'vue'
import { RouterView, RouterLink, useRoute, useRouter } from 'vue-router'
import { useQueryClient } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import {
  NLayout,
  NLayoutSider,
  NLayoutHeader,
  NLayoutContent,
  NMenu,
  NButton,
  NTag,
  NDropdown,
  NAvatar,
  NSelect,
} from 'naive-ui'
import {
  LayoutDashboard,
  Database,
  Layers,
  Clock3,
  Warehouse,
  ShieldCheck,
  Radio,
  Settings,
  Moon,
  Sun,
  ChevronRight,
} from 'lucide-vue-next'
import { navigation } from '../navigation'
import { useUiStore } from '../stores'
import {
  useSession,
  useSettings,
  useAuthentication,
  PasswordChangeDrawer,
} from '@/modules/identity'
import { displayTimeZoneKey } from '@/shared/composables/use-display-time'
import { permissionsKey } from '@/shared/security/permissions'
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
const { t } = useI18n(),
  ui = useUiStore(),
  route = useRoute(),
  router = useRouter(),
  cache = useQueryClient()
const session = useSession(
  () => ui.role,
  () => ui.userId,
)
const settings = useSettings()
const real = import.meta.env.VITE_API_MODE === 'real'
const authentication = useAuthentication()
const passwordOpen = ref(false)
async function accountAction(key: string) {
  if (key === 'password') {
    passwordOpen.value = true
    return
  }
  await logout()
}
async function passwordChanged() {
  ui.logout()
  cache.clear()
  await router.push('/login')
}
provide(
  displayTimeZoneKey,
  computed(() => settings.data.value?.timezone ?? 'Asia/Shanghai'),
)
provide(
  permissionsKey,
  computed(() => session.data.value?.permissions ?? []),
)
const icons = {
  overview: LayoutDashboard,
  sources: Database,
  datasets: Layers,
  tasks: Clock3,
  warehouse: Warehouse,
  governance: ShieldCheck,
  services: Radio,
  system: Settings,
}
const menu = computed(() =>
  navigation.map((item) => {
    const icon = () => h(icons[item.icon as keyof typeof icons], { size: 19 })
    if (item.entries.length === 1)
      return {
        key: item.entries[0]!.path,
        label: () => h(RouterLink, { to: item.entries[0]!.path }, () => t('nav.' + item.key)),
        icon,
      }
    return {
      key: item.key,
      label: t('nav.' + item.key),
      icon,
      children: item.entries.map((entry) => ({
        key: entry.path,
        label: () => h(RouterLink, { to: entry.path }, () => t(entry.labelKey)),
      })),
    }
  }),
)
const section = computed(() => String(route.meta.section ?? 'overview'))
const activeMenu = computed(() => {
  const candidates = navigation
    .flatMap((group) => group.entries)
    .filter((entry) => route.path === entry.path || route.path.startsWith(entry.path + '/'))
  return candidates.sort((a, b) => b.path.length - a.path.length)[0]?.path ?? '/overview'
})
async function changeRole(role: string) {
  ui.setRole(role)
  await cache.cancelQueries()
  cache.clear()
  await router.replace('/overview')
}
async function logout() {
  if (real) {
    try {
      await authentication.logout.mutateAsync()
    } catch {
      return
    }
  }
  ui.logout()
  cache.clear()
  await router.push('/login')
}
</script>
<template>
  <NLayout has-sider class="app-shell"
    ><NLayoutSider
      :width="224"
      :collapsed-width="72"
      :collapsed="ui.collapsed"
      collapse-mode="width"
      bordered
      show-trigger="bar"
      @update:collapsed="ui.collapsed = $event"
      ><RouterLink to="/overview" class="brand"
        ><div class="brand-mark">{{ uiText('ui.workspace_layout_27a2b9f1') }}</div>
        <div v-if="!ui.collapsed">
          <strong>{{ t('brand') }}</strong
          ><small>JIUZHANG DATA</small>
        </div></RouterLink
      >
      <div v-if="!ui.collapsed" class="nav-caption">{{ t('workspace') }}</div>
      <NMenu
        :value="activeMenu"
        :default-expanded-keys="[section]"
        :options="menu"
        :collapsed="ui.collapsed"
        :collapsed-width="72"
        :indent="20"
      />
      <div v-if="!ui.collapsed" class="sidebar-footer">
        <span class="status-dot" />{{ real ? t('identity.realMode') : t('mock')
        }}<small>LOCAL WORKSPACE</small>
      </div></NLayoutSider
    ><NLayout class="workspace-main"
      ><NLayoutHeader bordered class="topbar"
        ><div class="breadcrumb">
          <span>{{ t('workspace') }}</span
          ><ChevronRight :size="13" /><strong>{{ t('nav.' + section) }}</strong>
        </div>
        <div class="topbar-actions">
          <NTag size="small" :bordered="false" :type="real ? 'success' : 'warning'">{{
            real ? t('identity.realMode') : t('mock')
          }}</NTag
          ><NButton quaternary circle :aria-label="t('theme')" @click="ui.toggleDarkMode"
            ><Sun v-if="ui.darkMode" :size="18" /><Moon v-else :size="18" /></NButton
          ><NSelect
            v-if="!real"
            :value="ui.role"
            :options="['admin', 'developer', 'viewer'].map((value) => ({ value, label: t(value) }))"
            v-select-trigger-name="t('role')"
            style="width: 140px"
            size="small"
            @update:value="changeRole"
          /><NDropdown
            :options="
              real
                ? [
                    { label: t('identity.changePassword'), key: 'password' },
                    { label: t('identity.signOut'), key: 'logout' },
                  ]
                : [{ label: t('logout'), key: 'logout' }]
            "
            @select="accountAction"
            ><NButton
              quaternary
              circle
              :aria-label="real ? t('identity.signOut') : t('logout')"
              :loading="authentication.logout.isPending.value"
              ><NAvatar round :size="30">{{ t('brand').slice(0, 1) }}</NAvatar></NButton
            ></NDropdown
          >
        </div></NLayoutHeader
      ><NLayoutContent
        class="main-content"
        :class="{ 'main-content--source-detail': route.meta.id === 'P04' }"
        ><RouterView :key="route.path" /></NLayoutContent></NLayout
  ></NLayout>
  <PasswordChangeDrawer v-if="real" v-model="passwordOpen" @changed="passwordChanged" />
</template>
<style scoped>
.app-shell {
  height: 100vh;
  overflow: hidden;
}
.app-shell :deep(.n-layout-sider) {
  height: 100vh;
  align-self: flex-start;
}
.workspace-main {
  height: 100vh;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.brand {
  height: 92px;
  padding: 0 22px;
  display: flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
  color: var(--textPrimary);
}
.brand-mark {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: var(--accent);
  color: var(--surfaceRaised);
  display: grid;
  place-items: center;
  font-size: 23px;
  font-weight: 700;
}
.brand strong {
  font-size: 21px;
  letter-spacing: 3px;
  display: block;
}
.brand small {
  font-size: 8px;
  letter-spacing: 1.3px;
  color: var(--textSecondary);
}
.nav-caption {
  font-size: 10px;
  color: var(--textSecondary);
  padding: 18px 28px 10px;
  letter-spacing: 1px;
}
.sidebar-footer {
  position: absolute;
  bottom: 30px;
  left: 26px;
  font-size: 12px;
  color: var(--textSecondary);
}
.sidebar-footer small {
  display: block;
  margin-top: 8px;
  font-size: 9px;
  letter-spacing: 1px;
}
.status-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  margin-right: 8px;
}
.topbar {
  height: 68px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 32px;
}
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--textSecondary);
}
.breadcrumb strong {
  color: var(--textPrimary);
  font-weight: 500;
}
.topbar-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}
.main-content {
  padding: 30px 32px 72px;
  background: var(--surface);
  height: calc(100vh - 68px);
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior-y: contain;
}
.main-content--source-detail {
  padding-bottom: 24px;
}
@media (max-width: 1000px) {
  .topbar {
    padding: 0 20px;
  }
  .breadcrumb > span {
    display: none;
  }
  .main-content {
    padding: 24px 20px 80px;
  }
}
</style>
