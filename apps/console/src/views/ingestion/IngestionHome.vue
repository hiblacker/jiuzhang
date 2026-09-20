<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { NAlert, NButton, NDataTable, NInput, NSpace, NTabs, NTabPane, type DataTableColumns } from 'naive-ui';
import { usePermissionStore } from '@/stores/permission';
import { useProjectStore } from '@/stores/project';
import { usePagedQuery } from '@/composables/usePagedQuery';
import AppPager from '@/components/AppPager.vue';
import IngestionView from './IngestionView.vue';
import ChannelWizard from './ChannelWizard.vue';

const project = useProjectStore();
const permission = usePermissionStore();
const tab = ref('connections');
const projectId = computed(() => project.selected?.id ?? 0);
const selected = ref<Entry | null>(null);
watch(projectId, () => {
  selected.value = null;
});
// Mount the paged list only for authorized roles; VIEWER must never query engineering endpoints.
</script>
<template>
  <section class="ingestion-home">
    <n-tabs v-model:value="tab" type="line" @update:value="selected = null">
      <n-tab-pane name="connections"><template #tab>数据源</template></n-tab-pane>
      <n-tab-pane name="channels"><template #tab>采集数据集</template></n-tab-pane>
      <n-tab-pane name="systems"><template #tab>业务系统</template></n-tab-pane>
    </n-tabs>
    <IngestionView v-if="tab === 'systems'" :key="projectId" />
    <n-alert v-else-if="!permission.canIngest" type="info">
      当前项目角色无接入管理权限，需要数据工程师或项目负责人角色。
    </n-alert>
    <template v-else>
      <NSpace class="gap">
        <NButton v-if="selected" @click="selected = null">返回列表</NButton>
        <NButton @click="tab = 'systems'">管理业务系统与新增接入</NButton>
      </NSpace>
      <ChannelWizard
        v-if="selected"
        :key="`${projectId}:${tab}:${selected.id}`"
        :project="projectId"
        :instances="[{ id: selected.instance_id, name: '所属环境实例', code: '' }]"
        :can-manage="permission.canIngest"
        :can-activate="permission.canManage"
        :initial-connection-id="tab === 'connections' ? selected.id : selected.connection_id"
        :initial-source-id="tab === 'channels' ? selected.id : undefined"
      />
      <CatalogList v-else :key="`${projectId}:${tab}`" :project="projectId" :kind="tab" @select="selected = $event" />
    </template>
  </section>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
interface Entry {
  id: number;
  name: string;
  code: string;
  instance_id: number;
  connection_id?: number;
  kind?: string;
  lifecycle: string;
  active_version: number;
}
const states: Record<string, string> = { DRAFT: '草稿', ACTIVE: '启用', PAUSED: '暂停', RETIRED: '退役' };
const kinds: Record<string, string> = { MYSQL_SNAPSHOT: 'MySQL', FILE_SCAN: '文件目录', REST_PULL: 'REST API' };
const CatalogList = defineComponent({
  props: { project: { type: Number, required: true }, kind: { type: String, required: true } },
  emits: { select: (entry: Entry) => Number.isInteger(entry.id) },
  setup(props, { emit }) {
    const { rows, query, page, total, loading, listError, search } = usePagedQuery<Entry>({
      route: ({ page, query, limit }) =>
        `/warehouse/catalog/projects/${props.project}/${props.kind}?q=${encodeURIComponent(query)}&limit=${limit}&offset=${(page - 1) * limit}`,
    });
    const columns: DataTableColumns<Entry> = [
      {
        title: props.kind === 'connections' ? '数据源' : '采集数据集',
        key: 'name',
        render: (row) =>
          h(NButton, { text: true, type: 'primary', onClick: () => emit('select', row) }, () => row.name),
      },
      { title: '编码', key: 'code' },
      { title: '状态', key: 'lifecycle', render: (row) => states[row.lifecycle] || row.lifecycle },
      { title: '版本', key: 'active_version' },
    ];
    if (props.kind === 'connections')
      columns.splice(2, 0, { title: '类型', key: 'kind', render: (row) => kinds[row.kind || ''] || row.kind || '' });
    return () =>
      h('div', [
        h(NSpace, { class: 'gap' }, () => [
          h(NInput, {
            value: query.value,
            placeholder: '按名称搜索',
            'onUpdate:value': (value: string) => {
              query.value = value;
            },
            onKeyup: (event: KeyboardEvent) => {
              if (event.key === 'Enter') search();
            },
          }),
          h(NButton, { onClick: search }, () => '搜索'),
        ]),
        listError.value ? h(NAlert, { type: 'error', class: 'gap' }, () => listError.value) : null,
        h(NDataTable, {
          columns,
          data: rows.value,
          loading: loading.value,
          scrollX: 650,
          rowKey: (row: Entry) => row.id,
        }),
        h(AppPager, {
          page: page.value,
          itemCount: total.value,
          'onUpdate:page': (value: number) => {
            page.value = value;
          },
        }),
      ]);
  },
});
</script>
