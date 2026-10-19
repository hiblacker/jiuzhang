<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NDrawer, NDrawerContent, NForm, NFormItem, NInput, NButton } from 'naive-ui'
import { useAuthentication } from '../composables/use-system'
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ changed: [] }>()
const { t } = useI18n()
const auth = useAuthentication()
const values = ref({ currentPassword: '', newPassword: '' })
async function save() {
  if (auth.password.isPending.value) return
  try {
    await auth.password.mutateAsync(values.value)
    values.value = { currentPassword: '', newPassword: '' }
    open.value = false
    emit('changed')
  } catch {}
}
</script>
<template>
  <NDrawer
    :show="open"
    :width="440"
    :mask-closable="!auth.password.isPending.value"
    :close-on-esc="!auth.password.isPending.value"
    @update:show="open = $event"
  >
    <NDrawerContent
      :title="t('identity.changePassword')"
      :closable="!auth.password.isPending.value"
    >
      <NForm :model="values" label-placement="top" @submit.prevent="save">
        <NFormItem :label="t('identity.currentPassword')"
          ><NInput
            v-model:value="values.currentPassword"
            type="password"
            :input-props="{
              'aria-label': t('identity.currentPassword'),
              autocomplete: 'current-password',
            }"
        /></NFormItem>
        <NFormItem :label="t('identity.newPassword')"
          ><NInput
            v-model:value="values.newPassword"
            type="password"
            :input-props="{
              'aria-label': t('identity.newPassword'),
              autocomplete: 'new-password',
            }"
        /></NFormItem>
        <NButton attr-type="submit" type="primary" :loading="auth.password.isPending.value">{{
          t('save')
        }}</NButton>
      </NForm>
    </NDrawerContent>
  </NDrawer>
</template>
