<script setup lang="ts">
import { NAlert, NButton, NFormItem, NInput, NModal } from 'naive-ui';
import AppJsonBlock from '@/components/AppJsonBlock.vue';

// The two "are you sure" dialogs of a rule/credential change. They are pure UI: the parent owns
// the flow, this component only collects the reasons and reports the two decisions.
const changeVisible = defineModel<boolean>('changeVisible', { required: true });
const changeReason = defineModel<string>('changeReason', { required: true });
const versionVisible = defineModel<boolean>('versionVisible', { required: true });
const versionReason = defineModel<string>('versionReason', { required: true });
const description = defineModel<string>('description', { required: true });
const props = defineProps<{
  error: string;
  impact: unknown;
  preview: unknown;
  activeVersion?: number;
  connectionKind?: string;
  busy: boolean;
}>();
const emit = defineEmits<{ confirmChange: []; saveVersion: [] }>();
</script>

<template>
  <n-modal v-model:show="changeVisible" preset="card" title="确认采集规则变更" style="width: min(800px, 95vw)">
    <n-alert v-if="props.error" type="error">{{ props.error }}</n-alert>
    <p>新规则需重新预检与启用计划，既有执行和历史交付约定继续保留。</p>
    <AppJsonBlock :value="props.preview" />
    <n-input v-model:value="changeReason" placeholder="范围或规则变更原因" />
    <n-button
      class="gap"
      type="primary"
      :disabled="!changeReason.trim()"
      :loading="props.busy"
      @click="emit('confirmChange')"
      >确认变更并测试</n-button
    >
  </n-modal>
  <n-modal v-model:show="versionVisible" preset="card" title="连接版本与影响" style="width: min(800px, 95vw)">
    <n-alert v-if="props.error" type="error">{{ props.error }}</n-alert>
    <p>
      当前版本
      {{
        props.activeVersion
      }}。发布新版本后，各通道通过“修改采集规则”显式选择，正在执行的配置不会被改写。凭证由管理员在批准资源边界内轮换。
    </p>
    <AppJsonBlock :value="props.impact" />
    <n-form-item v-if="props.connectionKind !== 'MYSQL_SNAPSHOT'" label="连接说明">
      <n-input v-model:value="description" />
    </n-form-item>
    <n-form-item label="新版本原因"><n-input v-model:value="versionReason" /></n-form-item>
    <n-button type="primary" :disabled="!versionReason.trim()" :loading="props.busy" @click="emit('saveVersion')"
      >发布连接配置新版本</n-button
    >
  </n-modal>
</template>
