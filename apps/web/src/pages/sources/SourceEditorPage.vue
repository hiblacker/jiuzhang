<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NButton, NCard, NAlert, NSpace, useMessage } from 'naive-ui'
import { useSourceEditor, SourceConnectionForm } from '@/modules/sources'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { DataPreview } from '@/shared/ui/data-preview'
import { errorKey } from '@/shared/api/error-message'
import { useEditGuard } from '@/shared/composables/use-edit-guard'
const { t } = useI18n(),
  route = useRoute(),
  router = useRouter(),
  message = useMessage()
const id = computed(() => String(route.params.id ?? ''))
const { query, draft, dirty, changes, save, test } = useSourceEditor(id)
const differenceRows = computed(() =>
  changes.value.map((change) => ({
    field: t(change.labelKey),
    before: change.before,
    after: change.after,
  })),
)
const form = ref<InstanceType<typeof SourceConnectionForm>>()
async function submit() {
  if (save.isPending.value || test.isPending.value) return
  try {
    await form.value?.validate()
  } catch {
    return
  }
  if (save.isPending.value || test.isPending.value) return
  try {
    const result = await save.mutateAsync()
    message.success(t('saveSuccess'))
    await router.push('/sources/' + result.id)
  } catch {}
}
async function testConnection() {
  if (test.isPending.value || save.isPending.value) return
  try {
    await form.value?.validate()
  } catch {
    return
  }
  if (test.isPending.value || save.isPending.value) return
  try {
    await test.mutateAsync()
  } catch {}
}
useEditGuard(dirty, () => save.isPending.value || test.isPending.value)
</script>
<template>
  <PageHeader
    :title="id ? t('sources.edit') : t('sources.new')"
    :description="t('sources.description')"
    ><NButton
      :disabled="save.isPending.value || test.isPending.value"
      @click="router.push(id ? '/sources/' + id : '/sources')"
      >{{ t('cancel') }}</NButton
    ><NButton
      type="primary"
      :disabled="test.isPending.value"
      :loading="save.isPending.value"
      @click="submit"
      >{{ t('save') }}</NButton
    ></PageHeader
  ><AsyncState
    :loading="!!id && query.isLoading.value"
    :error="query.error.value"
    @retry="query.refetch()"
    ><NCard class="form-card" :bordered="false"
      ><NAlert v-if="save.error.value" type="error" class="mb">{{
        t(errorKey(save.error.value))
      }}</NAlert
      ><SourceConnectionForm
        ref="form"
        v-model="draft"
        :disabled="save.isPending.value || test.isPending.value"
      /><NSpace vertical
        ><NButton
          secondary
          type="primary"
          :loading="test.isPending.value"
          :disabled="save.isPending.value"
          @click="testConnection"
          >{{ t('sources.test') }}</NButton
        ><NAlert v-if="test.data.value" :type="test.data.value.success ? 'success' : 'warning'">{{
          test.data.value.success ? t('sources.testPass') : t('sources.testFail')
        }}</NAlert
        ><NAlert v-if="test.error.value" type="error">{{
          t(errorKey(test.error.value))
        }}</NAlert></NSpace
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
