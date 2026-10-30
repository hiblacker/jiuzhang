<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NButton, NCard, NAlert, NSpace, useMessage } from 'naive-ui'
import { useSourceEditor, SourceConnectionForm } from '@/modules/sources'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { DataPreview } from '@/shared/ui/data-preview'
import { useEditGuard } from '@/shared/composables/use-edit-guard'
const { t } = useI18n(),
  route = useRoute(),
  router = useRouter(),
  message = useMessage()
const id = computed(() => String(route.params.id ?? ''))
const { query, draft, credentials, dirty, changes, save, test } = useSourceEditor(id)
const fileBusy = ref(false)
const submitting = ref(false)
const busy = computed(
  () => save.isPending.value || test.isPending.value || fileBusy.value || submitting.value,
)
const differenceRows = computed(() =>
  changes.value.map((change) => ({
    field: t(change.labelKey),
    before: change.before,
    after: change.after,
  })),
)
const form = ref<InstanceType<typeof SourceConnectionForm>>()
async function submit() {
  if (busy.value) return
  submitting.value = true
  try {
    await form.value?.validate()
  } catch {
    submitting.value = false
    return
  }
  try {
    const result = await save.mutateAsync()
    message.success(t('saveSuccess'))
    submitting.value = false
    await router.push('/sources/' + result.id)
  } catch {
  } finally {
    submitting.value = false
  }
}
async function testConnection() {
  if (busy.value) return
  submitting.value = true
  try {
    await form.value?.validate()
  } catch {
    submitting.value = false
    return
  }
  try {
    const result = await test.mutateAsync()
    if (result.success)
      message.success(
        draft.value.type === 'Excel' ? t('sources.excelTestPass') : t('sources.realTestPass'),
      )
    else message.error(t('sources.testFail'))
  } catch {
  } finally {
    submitting.value = false
  }
}
useEditGuard(dirty, busy)
</script>
<template>
  <PageHeader
    :title="id ? t('sources.edit') : t('sources.new')"
    :description="t('sources.description')"
    ><NButton :disabled="busy" @click="router.push(id ? '/sources/' + id : '/sources')">{{
      t('cancel')
    }}</NButton
    ><NButton type="primary" :disabled="busy" :loading="save.isPending.value" @click="submit">{{
      t('save')
    }}</NButton></PageHeader
  ><AsyncState
    :loading="!!id && query.isLoading.value"
    :error="query.error.value"
    @retry="query.refetch()"
    ><NCard class="form-card" :bordered="false"
      ><SourceConnectionForm
        ref="form"
        v-model="draft"
        v-model:credentials="credentials"
        :disabled="busy"
        :editing="!!id"
        @busy="fileBusy = $event"
      /><NSpace vertical
        ><NButton
          secondary
          type="primary"
          :loading="test.isPending.value"
          :disabled="busy"
          @click="testConnection"
          >{{ draft.type === 'Excel' ? t('sources.excelTest') : t('sources.realTest') }}</NButton
        ></NSpace
      >
      <section v-if="id" :aria-label="t('sources.configurationDiff')" class="configuration-diff">
        <h2>{{ t('sources.configurationDiff') }}</h2>
        <p>{{ t('sources.diffDescription') }}</p>
        <DataPreview
          v-if="differenceRows.length"
          :columns="[
            { key: 'field', title: t('sources.diffField') },
            { key: 'before', title: t('sources.diffBefore') },
            { key: 'after', title: t('sources.diffAfter') },
          ]"
          :rows="differenceRows"
        />
        <NAlert v-else type="info">{{ t('sources.diffUnchanged') }}</NAlert>
      </section></NCard
    ></AsyncState
  >
</template>
<style scoped>
.configuration-diff {
  margin-top: 24px;
  min-width: 0;
}
.configuration-diff h2 {
  font-size: 16px;
}
.configuration-diff p {
  color: var(--textSecondary);
  overflow-wrap: anywhere;
}
</style>
