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
    const result = await test.mutateAsync()
    if (result.success) message.success(t('sources.realTestPass'))
    else message.error(t('sources.testFail'))
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
      ><SourceConnectionForm
        ref="form"
        v-model="draft"
        v-model:credentials="credentials"
        :disabled="save.isPending.value || test.isPending.value"
      /><NSpace vertical
        ><NButton
          secondary
          type="primary"
          :loading="test.isPending.value"
          :disabled="save.isPending.value"
          @click="testConnection"
          >{{ t('sources.realTest') }}</NButton
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
