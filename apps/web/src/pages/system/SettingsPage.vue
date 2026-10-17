<script setup lang="ts">
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

const canWrite = useCan('write')
import { computed, ref, watch } from 'vue'
import { NCard, NButton, NSelect, NForm, NFormItem, NSwitch, NAlert } from 'naive-ui'
import { useSettings, useSystemActions } from '@/modules/identity'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { useCan } from '@/shared/security/permissions'
import { useEditGuard } from '@/shared/composables/use-edit-guard'
const query = useSettings(),
  actions = useSystemActions(),
  draft = ref({ timezone: 'Asia/Shanghai', notifications: false }),
  baseline = ref(''),
  dirty = computed(() => Boolean(baseline.value && JSON.stringify(draft.value) !== baseline.value))
useEditGuard(dirty, actions.settings.isPending)
watch(
  () => query.data.value,
  (data) => {
    if (data && !dirty.value) {
      draft.value = { ...data }
      baseline.value = JSON.stringify(data)
    }
  },
  { immediate: true },
)
async function save() {
  if (!canWrite.value || actions.settings.isPending.value) return
  try {
    const saved = await actions.settings.mutateAsync({ ...draft.value })
    draft.value = { ...saved }
    baseline.value = JSON.stringify(saved)
  } catch {}
}
</script>
<template>
  <PageHeader :title="uiText('ui.settings_e976eab5')" :description="uiText('ui.settings_676e9a5e')"
    ><NButton
      :loading="query.isFetching.value"
      :disabled="actions.settings.isPending.value"
      @click="query.refetch()"
      >{{ uiText('refresh') }}</NButton
    ></PageHeader
  ><AsyncState :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch()"
    ><NCard class="form-card" :bordered="false"
      ><NForm :disabled="!canWrite || actions.settings.isPending.value" label-placement="top"
        ><NFormItem :label="uiText('ui.settings_e071c541')"
          ><NSelect
            v-model:value="draft.timezone"
            v-select-trigger-name="uiText('ui.settings_e071c541')"
            :options="[
              { value: 'Asia/Shanghai', label: 'Asia/Shanghai (UTC+8)' },
              { value: 'UTC', label: 'UTC' },
            ]" /></NFormItem
        ><NFormItem :label="uiText('ui.settings_96335b00')"
          ><NSwitch
            v-model:value="draft.notifications"
            :aria-label="uiText('ui.settings_96335b00')" /></NFormItem
        ><NAlert type="info" class="mb">{{ uiText('ui.settings_e5d0c24e') }}</NAlert
        ><NButton
          type="primary"
          :disabled="!canWrite"
          :loading="actions.settings.isPending.value"
          @click="save"
          >{{ uiText('ui.settings_bb79ec7c') }}</NButton
        ><NAlert
          v-if="actions.settings.isSuccess.value && !dirty"
          type="success"
          style="margin-top: 20px"
          >{{ uiText('ui.settings_02fb989c') }}</NAlert
        ><NAlert v-if="actions.settings.error.value" type="error" style="margin-top: 20px">{{
          uiText('ui.settings_18b4e26f')
        }}</NAlert></NForm
      ></NCard
    ></AsyncState
  >
</template>
