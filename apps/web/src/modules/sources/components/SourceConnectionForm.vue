<script setup lang="ts">
import { TagEditor } from '@/shared/ui/tag-editor'
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import { computed, ref } from 'vue'
import {
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSelect,
  NSwitch,
  NGrid,
  NFormItemGi,
  NAlert,
  type FormInst,
  type FormRules,
} from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { SourceInput } from '../api/source-repository'
import { connectorOptions, connectorRegistry } from '../model/connectors'
import { parseJsonObject } from '@/shared/lib/json'
const draft = defineModel<SourceInput>({ required: true })
defineProps<{ disabled?: boolean }>()
const form = ref<FormInst>()
const { t } = useI18n()
const connector = computed(() => connectorRegistry[draft.value.type])
function selectConnector(type: SourceInput['type']) {
  draft.value.type = type
  draft.value.settings.port = connectorRegistry[type].port
}
const rules = computed<FormRules>(() => ({
  name: { required: true, whitespace: true, message: t('sources.required'), trigger: 'blur' },
  owner: { required: true, whitespace: true, message: t('sources.required'), trigger: 'blur' },
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
      draft.value.settings.port >= 1 &&
      draft.value.settings.port <= 65535
        ? true
        : new Error(t('sources.invalidPort')),
  },
  'settings.rateLimit': {
    trigger: ['blur', 'change'],
    validator: () =>
      Number.isInteger(draft.value.settings.rateLimit) &&
      draft.value.settings.rateLimit >= 1 &&
      draft.value.settings.rateLimit <= 10000
        ? true
        : new Error(t('sources.invalidRateLimit')),
  },
  'settings.baseUrl': {
    trigger: 'blur',
    validator: () => {
      try {
        const url = new URL(draft.value.settings.baseUrl)
        return url.protocol === 'https:' && !url.username && !url.password
          ? true
          : new Error(t('sources.invalidUrl'))
      } catch {
        return new Error(t('sources.invalidUrl'))
      }
    },
  },
  ...Object.fromEntries(
    ['headers', 'query', 'body'].map((key) => [
      'settings.' + key,
      {
        trigger: 'blur',
        validator: (_rule: unknown, value: string) => {
          try {
            parseJsonObject(value)
            return true
          } catch {
            return new Error(t('sources.invalidJson'))
          }
        },
      },
    ]),
  ),
}))
defineExpose({ validate: () => form.value?.validate() })
</script>
<template>
  <NForm ref="form" :model="draft" :rules="rules" :disabled="disabled" label-placement="top"
    ><h3>{{ t('sources.basic') }}</h3>
    <NGrid cols="1 640:2" responsive="self" :x-gap="24"
      ><NFormItemGi :label="t('name')" path="name"
        ><NInput
          v-model:value="draft.name"
          :placeholder="t('name')"
          :input-props="{ 'aria-label': t('name') }" /></NFormItemGi
      ><NFormItemGi :label="t('type')" path="type"
        ><NSelect
          :value="draft.type"
          :options="connectorOptions"
          v-select-trigger-name="t('type')"
          @update:value="selectConnector" /></NFormItemGi
      ><NFormItemGi :label="t('owner')" path="owner"
        ><NInput
          v-model:value="draft.owner"
          :input-props="{ 'aria-label': t('owner') }" /></NFormItemGi
      ><NFormItemGi :label="t('tags')"
        ><TagEditor v-model="draft.tags" :disabled="disabled" /></NFormItemGi></NGrid
    ><NFormItem :label="t('description')"
      ><NInput
        v-model:value="draft.description"
        :input-props="{ 'aria-label': t('description') }"
        type="textarea"
        :rows="2"
    /></NFormItem>
    <h3>{{ connector.kind === 'api' ? t('sources.api') : t('sources.connection') }}</h3>
    <NAlert type="info" class="form-note">{{ t('sources.placeholder') }}</NAlert
    ><template v-if="connector.kind === 'api'"
      ><NGrid cols="1 640:2" responsive="self" :x-gap="24"
        ><NFormItemGi :label="t('sources.baseUrl')" path="settings.baseUrl"
          ><NInput
            v-model:value="draft.settings.baseUrl"
            :input-props="{ 'aria-label': t('sources.baseUrl') }" /></NFormItemGi
        ><NFormItemGi :label="t('sources.path')"
          ><NInput
            v-model:value="draft.settings.path"
            :input-props="{ 'aria-label': t('sources.path') }" /></NFormItemGi
        ><NFormItemGi :label="t('sources.method')"
          ><NSelect
            v-model:value="draft.settings.method"
            v-select-trigger-name="t('sources.method')"
            :options="['GET', 'POST'].map((value) => ({ label: value, value }))" /></NFormItemGi
        ><NFormItemGi :label="t('sources.auth')"
          ><NSelect
            v-model:value="draft.settings.authType"
            v-select-trigger-name="t('sources.auth')"
            :options="[
              { label: t('sources.none'), value: 'none' },
              { label: 'Bearer (dummy)', value: 'bearer' },
              { label: 'Basic (dummy)', value: 'basic' },
            ]" /></NFormItemGi
        ><NFormItemGi :label="t('sources.pagination')"
          ><NSelect
            v-model:value="draft.settings.pagination"
            v-select-trigger-name="t('sources.pagination')"
            :options="[
              { label: t('sources.none'), value: 'none' },
              { label: t('sources.page'), value: 'page' },
              { label: t('sources.cursor'), value: 'cursor' },
            ]" /></NFormItemGi
        ><NFormItemGi :label="t('sources.dataPath')"
          ><NInput
            v-model:value="draft.settings.dataPath"
            :input-props="{ 'aria-label': t('sources.dataPath') }" /></NFormItemGi></NGrid
      ><NFormItem
        v-for="key in ['headers', 'query', 'body'] as const"
        :key="key"
        :label="t('sources.' + key)"
        :path="'settings.' + key"
        ><NInput
          v-model:value="draft.settings[key]"
          :input-props="{ 'aria-label': t('sources.' + key) }"
          type="textarea"
          :rows="2" /></NFormItem></template
    ><NGrid v-else-if="connector.kind === 'database'" cols="1 640:2" responsive="self" :x-gap="24"
      ><NFormItemGi :label="t('sources.host')" path="settings.host"
        ><NInput
          v-model:value="draft.settings.host"
          :input-props="{ 'aria-label': t('sources.host') }" /></NFormItemGi
      ><NFormItemGi :label="t('sources.port')" path="settings.port"
        ><NInputNumber
          v-model:value="draft.settings.port"
          :input-props="{ 'aria-label': t('sources.port') }"
          :min="1"
          :max="65535" /></NFormItemGi
      ><NFormItemGi :label="t('sources.database')" path="settings.database"
        ><NInput
          v-model:value="draft.settings.database"
          :input-props="{ 'aria-label': t('sources.database') }" /></NFormItemGi
      ><NFormItemGi v-if="connector.schema" :label="t('sources.schema')"
        ><NInput
          v-model:value="draft.settings.schema"
          :input-props="{ 'aria-label': t('sources.schema') }" /></NFormItemGi
      ><NFormItemGi :label="t('sources.tls')"
        ><NSwitch
          v-model:value="draft.settings.tls"
          :aria-label="t('sources.tls')" /></NFormItemGi></NGrid
    ><NAlert v-else type="default">CSV · {{ t('demoNote') }}</NAlert
    ><NGrid cols="1 640:2" responsive="self" :x-gap="24"
      ><NFormItemGi v-if="connector.incremental" :label="t('sources.incremental')"
        ><NInput
          v-model:value="draft.settings.incrementalField"
          :input-props="{ 'aria-label': t('sources.incremental') }" /></NFormItemGi
      ><NFormItemGi
        v-if="connector.rateLimit"
        :label="t('sources.rateLimit')"
        path="settings.rateLimit"
        ><NInputNumber
          v-model:value="draft.settings.rateLimit"
          :input-props="{ 'aria-label': t('sources.rateLimit') }"
          :min="1"
          :max="10000" /></NFormItemGi></NGrid
  ></NForm>
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
