<script setup lang="ts">
import { computed, h } from 'vue'
import { NDataTable, NButton, NTag, NSpace, NEllipsis, type DataTableColumns } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { Database } from 'lucide-vue-next'
import type { Source } from '../api/source-repository'
const props = defineProps<{ rows: Source[]; readonly?: boolean }>()
const emit = defineEmits<{ open: [id: string]; edit: [id: string]; delete: [id: string] }>()
const { t } = useI18n()
const columns = computed<DataTableColumns<Source>>(() => [
  {
    title: t('name'),
    key: 'name',
    width: 260,
    render: (row) =>
      h(
        NButton,
        {
          text: true,
          type: 'primary',
          class: 'resource-name',
          title: row.name,
          onClick: () => emit('open', row.id),
        },
        {
          icon: () => h(Database, { size: 18 }),
          default: () => h('span', { class: 'resource-name__text' }, row.name),
        },
      ),
  },
  {
    title: t('type'),
    key: 'type',
    width: 150,
    render: (row) => h(NTag, { bordered: false, size: 'small' }, { default: () => row.type }),
  },
  {
    title: t('status'),
    key: 'status',
    width: 120,
    render: (row) =>
      h(
        NTag,
        {
          bordered: false,
          size: 'small',
          type: ({ connected: 'success', warning: 'warning', offline: 'default' } as const)[
            row.status
          ],
        },
        { default: () => t(row.status) },
      ),
  },
  { title: t('objects'), key: 'objectCount', width: 90 },
  {
    title: t('owner'),
    key: 'owner',
    width: 140,
    render: (row) =>
      h(
        NEllipsis,
        {
          tabindex: 0,
          tooltip: {
            trigger: 'focus',
            contentStyle: { maxWidth: 'min(480px, calc(100vw - 32px))', overflowWrap: 'anywhere' },
          },
        },
        { default: () => row.owner, tooltip: () => h('span', { role: 'tooltip' }, row.owner) },
      ),
  },
  {
    title: t('actions'),
    key: 'actions',
    width: 160,
    render: (row) =>
      h(NSpace, {}, () => [
        h(
          NButton,
          {
            size: 'small',
            quaternary: true,
            disabled: props.readonly,
            onClick: () => emit('edit', row.id),
          },
          { default: () => t('edit') },
        ),
        h(
          NButton,
          {
            size: 'small',
            quaternary: true,
            type: 'error',
            disabled: props.readonly,
            onClick: () => emit('delete', row.id),
          },
          { default: () => t('delete') },
        ),
      ]),
  },
])
</script>
<template>
  <NDataTable
    :columns="columns"
    :data="rows"
    :row-key="(row) => row.id"
    :bordered="false"
    table-layout="fixed"
    :scroll-x="900"
  />
</template>
