<script setup lang="ts">
import { errorKey } from '@/shared/api/error-message'
import { useEditGuard } from '@/shared/composables/use-edit-guard'
import type { FormInst, FormRules } from 'naive-ui'
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

import { ref, h } from 'vue'
import {
  NCard,
  NButton,
  NSpace,
  NInput,
  NSelect,
  NDataTable,
  NSwitch,
  NDrawer,
  NDrawerContent,
  NForm,
  NFormItem,
  NAlert,
  NPagination,
} from 'naive-ui'
import { useRouter } from 'vue-router'
import { useUsers, useSystemActions } from '@/modules/identity'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import type { Model } from '@/shared/api/types'
import { useListRoute } from '@/shared/composables/use-list-route'
const router = useRouter(),
  { filters, update, bindPagination } = useListRoute(),
  query = useUsers(() =>
    Object.fromEntries(Object.entries(filters.value).map(([key, value]) => [key, String(value)])),
  ),
  actions = useSystemActions(),
  open = ref(false),
  id = ref(''),
  draft = ref<Model<'UserInput'>>({ name: '', role: 'developer', enabled: true })
bindPagination(() =>
  query.isSuccess.value && !query.isFetching.value ? query.data.value?.meta : undefined,
)
const roles = [
  { label: uiText('ui.users_02926ddd'), value: 'admin' },
  { label: uiText('ui.users_a6f235ef'), value: 'developer' },
  { label: uiText('ui.users_53ae4414'), value: 'viewer' },
]
const form = ref<FormInst | null>(null)
const baseline = ref('')
const { canLeave } = useEditGuard(
  () => open.value && baseline.value !== JSON.stringify(draft.value),
  actions.user.isPending,
)
function close(show: boolean) {
  if (show || canLeave()) open.value = show
}
const rules: FormRules = {
  name: { required: true, whitespace: true, message: uiText('required'), trigger: 'blur' },
}
function edit(user?: Model<'User'>) {
  actions.user.reset()
  id.value = user?.id ?? ''
  draft.value = user
    ? { name: user.name, role: user.role, enabled: user.enabled }
    : { name: '', role: 'developer', enabled: true }
  baseline.value = JSON.stringify(draft.value)
  open.value = true
}
async function save() {
  if (actions.user.isPending.value) return
  try {
    await form.value?.validate()
  } catch {
    return
  }
  if (actions.user.isPending.value) return
  try {
    await actions.user.mutateAsync({ body: { ...draft.value }, id: id.value || undefined })
    open.value = false
  } catch {}
}
const columns = [
  { title: uiText('ui.users_4fd1cfb1'), key: 'name' },
  {
    title: uiText('ui.users_6b26695e'),
    key: 'role',
    render: (u: Model<'User'>) => roles.find((r) => r.value === u.role)?.label,
  },
  {
    title: uiText('ui.users_62e951a6'),
    key: 'enabled',
    render: (u: Model<'User'>) =>
      u.enabled ? uiText('ui.users_d4e9ca3d') : uiText('ui.users_d989e551'),
  },
  { title: uiText('ui.users_093dea88'), key: 'updatedAt' },
  {
    title: uiText('ui.users_f3ea6d34'),
    key: 'action',
    render: (u: Model<'User'>) =>
      h(NButton, { size: 'small', onClick: () => edit(u) }, () => uiText('ui.users_a7f814c0')),
  },
]
</script>
<template>
  <PageHeader :title="uiText('ui.users_baf84751')" :description="uiText('ui.users_13f329dc')"
    ><NButton @click="router.push('/system/roles')">{{ uiText('ui.users_3bfd36ae') }}</NButton
    ><NButton @click="router.push('/system/audit')">{{ uiText('ui.users_7666cd43') }}</NButton
    ><NButton type="primary" @click="edit()">{{ uiText('ui.users_42dad3be') }}</NButton></PageHeader
  ><NCard :bordered="false"
    ><NInput
      :value="filters.q"
      @update:value="update({ q: $event, page: 1 })"
      clearable
      :placeholder="uiText('ui.users_d9574e76')"
      style="max-width: 320px; margin-bottom: 24px" /><AsyncState
      :loading="query.isLoading.value"
      :error="query.error.value"
      :empty="query.data.value?.data.length === 0"
      @retry="query.refetch()"
      ><NDataTable
        :data="query.data.value?.data ?? []"
        :columns="columns"
        :scroll-x="740"
        :bordered="false"
    /></AsyncState>
    <div class="pagination">
      <span>{{ uiText('total', { total: query.data.value?.meta.total ?? 0 }) }}</span>
      <NPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :item-count="query.data.value?.meta.total ?? 0"
        show-size-picker
        :page-sizes="[20, 50, 100]"
        @update:page="update({ page: $event })"
        @update:page-size="update({ pageSize: $event, page: 1 })"
      /></div></NCard
  ><NDrawer
    :aria-label="uiText('ui.users_4fd1cfb1')"
    :show="open"
    :width="440"
    :mask-closable="!actions.user.isPending.value"
    :close-on-esc="!actions.user.isPending.value"
    @update:show="close"
    ><NDrawerContent :title="uiText('ui.users_4fd1cfb1')" :closable="!actions.user.isPending.value"
      ><NForm
        ref="form"
        :model="draft"
        :rules="rules"
        :disabled="actions.user.isPending.value"
        label-placement="top"
        ><NFormItem path="name" :label="uiText('ui.users_a311ed74')"
          ><NInput
            v-model:value="draft.name"
            :input-props="{ 'aria-label': uiText('ui.users_a311ed74') }"
            :placeholder="uiText('ui.users_a0085b12')" /></NFormItem
        ><NFormItem :label="uiText('ui.users_6b26695e')"
          ><NSelect
            v-model:value="draft.role"
            :aria-label="uiText('ui.users_6b26695e')"
            :options="roles" /></NFormItem
        ><NFormItem :label="uiText('ui.users_d4e9ca3d')"
          ><NSwitch
            v-model:value="draft.enabled"
            :aria-label="uiText('ui.users_d4e9ca3d')" /></NFormItem
        ><NAlert type="info">{{ uiText('ui.users_d965b287') }}</NAlert
        ><NAlert v-if="actions.user.error.value" type="error">{{
          uiText(errorKey(actions.user.error.value))
        }}</NAlert></NForm
      ><template #footer
        ><NSpace justify="end"
          ><NButton :disabled="actions.user.isPending.value" @click="close(false)">{{
            uiText('cancel')
          }}</NButton
          ><NButton type="primary" :loading="actions.user.isPending.value" @click="save">{{
            uiText('ui.users_408e75e8')
          }}</NButton></NSpace
        ></template
      ></NDrawerContent
    ></NDrawer
  >
</template>
