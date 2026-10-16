<script setup lang="ts">
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

import { computed, ref, watch } from 'vue'
import { NCard, NButton, NCheckboxGroup, NCheckbox, NAlert, NGrid, NGridItem } from 'naive-ui'
import { useRoles, useSystemActions } from '@/modules/identity'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import type { Model } from '@/shared/api/types'
import { useEditGuard } from '@/shared/composables/use-edit-guard'
const query = useRoles(),
  actions = useSystemActions(),
  drafts = ref<Model<'Role'>[]>([]),
  baselines = ref<Record<string, string>>({})
const dirty = computed(() =>
  drafts.value.some((role) => JSON.stringify(role.permissions) !== baselines.value[role.id]),
)
useEditGuard(dirty, actions.role.isPending)
watch(
  () => query.data.value,
  (data) => {
    if (data) {
      drafts.value = data.map((role) => {
        const current = drafts.value.find((draft) => draft.id === role.id)
        if (current && JSON.stringify(current.permissions) !== baselines.value[role.id])
          return current
        baselines.value[role.id] = JSON.stringify(role.permissions)
        return { ...role, permissions: [...role.permissions] }
      })
    }
  },
  { immediate: true },
)
async function save(role: Model<'Role'>) {
  if (actions.role.isPending.value) return
  try {
    const saved = await actions.role.mutateAsync({
      id: role.id,
      permissions: [...role.permissions],
    })
    baselines.value[role.id] = JSON.stringify(saved.permissions)
    role.permissions = [...saved.permissions]
  } catch {}
}
</script>
<template>
  <PageHeader
    :title="uiText('ui.roles_3bfd36ae')"
    :description="uiText('ui.roles_cf8d1696')"
  /><NAlert type="info" class="mb">{{ uiText('ui.roles_ed8f413c') }}</NAlert
  ><AsyncState :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch()"
    ><NGrid cols="1 640:2 1000:3" responsive="self" :x-gap="24" :y-gap="24"
      ><NGridItem v-for="role in drafts" :key="role.id"
        ><NCard :title="role.name" :bordered="false"
          ><NCheckboxGroup
            v-model:value="role.permissions"
            :disabled="role.id === 'admin' || actions.role.isPending.value"
            ><div class="permission">
              <NCheckbox value="read">{{ uiText('ui.roles_c2652f64') }}</NCheckbox>
            </div>
            <div class="permission">
              <NCheckbox value="write">{{ uiText('ui.roles_60013e54') }}</NCheckbox>
            </div>
            <div class="permission">
              <NCheckbox value="system">{{ uiText('ui.roles_9f37d8c7') }}</NCheckbox>
            </div>
            <div class="permission">
              <NCheckbox value="readSensitive">{{
                uiText('warehouse.sensitivePermission')
              }}</NCheckbox>
            </div></NCheckboxGroup
          ><NButton
            type="primary"
            secondary
            :disabled="role.id === 'admin'"
            :loading="actions.role.isPending.value"
            @click="save(role)"
            >{{ uiText('ui.roles_d5355d17') }}</NButton
          ></NCard
        ></NGridItem
      ></NGrid
    ><NAlert v-if="actions.role.error.value" type="error">{{ uiText('ui.roles_6c335814') }}</NAlert
    ><NAlert v-if="actions.role.isSuccess.value" type="success" style="margin-top: 20px">{{
      uiText('ui.roles_ce0c005d')
    }}</NAlert></AsyncState
  >
</template>
<style scoped>
.permission {
  margin: 18px 0;
}
</style>
