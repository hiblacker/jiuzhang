<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NAlert,
  NForm,
  NFormItem,
  NFormItemGi,
  NGrid,
  NInput,
  NInputNumber,
  NSwitch,
  NSelect,
  type FormInst,
  type FormRules,
} from 'naive-ui'
import { TagEditor } from '@/shared/ui/tag-editor'
import type { SourceInput } from '../api/source-repository'
import { connectorOptions } from '../model/connectors'
import ExcelSourceForm from './ExcelSourceForm.vue'
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'

const draft = defineModel<SourceInput>({ required: true })
const credentials = defineModel<{ username: string; password: string }>('credentials', {
  default: () => ({ username: '', password: '' }),
})
defineProps<{ disabled?: boolean; editing?: boolean }>()
const emit = defineEmits<{ busy: [value: boolean] }>()
const form = ref<FormInst>()
const { t } = useI18n()
const rules = computed<FormRules>(() => ({
  name: { required: true, whitespace: true, message: t('sources.required'), trigger: 'blur' },
  owner: { required: true, whitespace: true, message: t('sources.required'), trigger: 'blur' },
  ...(draft.value.type === 'Excel'
    ? {
        'settings.fileId': {
          required: true,
          message: t('sources.excelRequired'),
          trigger: 'change',
        },
        'settings.sheet': {
          required: true,
          message: t('sources.excelRequired'),
          trigger: 'change',
        },
        'settings.headerRow': {
          type: 'number' as const,
          required: true,
          min: 1,
          max: 1000,
          message: t('sources.excelHeaderInvalid'),
          trigger: ['blur', 'change'],
        },
      }
    : {
        'settings.host': {
          required: true,
          whitespace: true,
          message: t('sources.required'),
          trigger: 'blur',
        },
        'settings.database': {
          required: true,
          whitespace: true,
          message: t('sources.required'),
          trigger: 'blur',
        },
        'settings.port': {
          trigger: ['blur', 'change'],
          validator: () =>
            Number.isInteger(draft.value.settings.port) &&
            (draft.value.settings.port ?? 0) >= 1 &&
            (draft.value.settings.port ?? 0) <= 65535
              ? true
              : new Error(t('sources.invalidPort')),
        },
      }),
}))
defineExpose({ validate: () => form.value?.validate() })
</script>

<template>
  <NForm ref="form" :model="draft" :rules="rules" :disabled="disabled" label-placement="top">
    <h3>{{ t('sources.basic') }}</h3>
    <NGrid cols="1 640:2" responsive="self" :x-gap="24">
      <NFormItemGi :label="t('name')" path="name">
        <NInput
          v-model:value="draft.name"
          :placeholder="t('name')"
          :input-props="{ 'aria-label': t('name') }"
        />
      </NFormItemGi>
      <NFormItemGi :label="t('type')">
        <NSelect
          v-model:value="draft.type"
          v-select-trigger-name="t('type')"
          :options="connectorOptions"
          :disabled="disabled || editing"
          :input-props="{ 'aria-label': t('type') }"
        />
      </NFormItemGi>
      <NFormItemGi :label="t('owner')" path="owner">
        <NInput v-model:value="draft.owner" :input-props="{ 'aria-label': t('owner') }" />
      </NFormItemGi>
      <NFormItemGi :label="t('tags')">
        <TagEditor v-model="draft.tags" :disabled="disabled" />
      </NFormItemGi>
    </NGrid>
    <NFormItem :label="t('description')">
      <NInput
        v-model:value="draft.description"
        :input-props="{ 'aria-label': t('description') }"
        type="textarea"
        :rows="2"
      />
    </NFormItem>
    <ExcelSourceForm
      v-if="draft.type === 'Excel'"
      v-model="draft"
      :disabled="disabled"
      @busy="emit('busy', $event)"
    />
    <template v-else>
      <h3>{{ t('sources.connection') }}</h3>
      <NAlert type="info" class="form-note">{{ t('sources.realCredentialHint') }}</NAlert>
      <NGrid cols="1 640:2" responsive="self" :x-gap="24">
        <NFormItemGi :label="t('sources.realHost')" path="settings.host">
          <NInput
            v-model:value="draft.settings.host"
            :input-props="{ 'aria-label': t('sources.realHost') }"
          />
        </NFormItemGi>
        <NFormItemGi :label="t('sources.port')" path="settings.port">
          <NInputNumber
            v-model:value="draft.settings.port"
            :input-props="{ 'aria-label': t('sources.port') }"
            :min="1"
            :max="65535"
          />
        </NFormItemGi>
        <NFormItemGi :label="t('sources.database')" path="settings.database">
          <NInput
            v-model:value="draft.settings.database"
            :input-props="{ 'aria-label': t('sources.database') }"
          />
        </NFormItemGi>
        <NFormItemGi :label="t('sources.username')">
          <NInput
            v-model:value="credentials.username"
            :input-props="{ 'aria-label': t('sources.username'), autocomplete: 'off' }"
          />
        </NFormItemGi>
        <NFormItemGi :label="t('sources.password')">
          <NInput
            v-model:value="credentials.password"
            type="password"
            show-password-on="click"
            :input-props="{ 'aria-label': t('sources.password'), autocomplete: 'new-password' }"
          />
        </NFormItemGi>
        <NFormItemGi :label="t('sources.tls')">
          <NSwitch v-model:value="draft.settings.tls" :aria-label="t('sources.tls')" />
        </NFormItemGi>
      </NGrid>
    </template>
  </NForm>
</template>

<style scoped>
h3 {
  font-size: 15px;
  margin: 8px 0 20px;
}
.form-note {
  margin-bottom: 24px;
}
</style>
