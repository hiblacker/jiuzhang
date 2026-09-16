<script setup lang="ts" generic="T extends object">
import { computed, h } from 'vue'
import { NButton, NDataTable, NSpace, NTag, type DataTableColumns } from 'naive-ui'
import { display, type Action, type Column, type Row } from '../types'
const props = withDefaults(
  defineProps<{
    rows: T[]
    columns: Column[]
    actions?: (row: T) => Action[]
    loading?: boolean
    paginated?: boolean
  }>(),
  { paginated: true, actions: undefined },
)
const positive = ['COMPLETE', 'ACTIVE', 'RAW_COMMITTED', 'PARSED', 'READY', 'PUBLISHED', 'RECEIVED']
const negative = ['FAILED', 'MISSING', 'OVERDUE', 'REJECTED', 'INCOMPLETE']
const columns = computed<DataTableColumns<T>>(() => [
  ...props.columns.map(c => ({
    key: c.key,
    title: c.title,
    width: c.width ?? 155,
    ellipsis: { tooltip: true },
    render: (row: T) =>
      c.state
        ? h(
            NTag,
            {
              size: 'small',
              bordered: false,
              type: positive.includes(String((row as Row)[c.key]))
                ? 'success'
                : negative.includes(String((row as Row)[c.key]))
                  ? 'error'
                  : 'default',
            },
            () => display((row as Row)[c.key]),
          )
        : display((row as Row)[c.key]),
  })),
  ...(props.actions
    ? [
        {
          key: '_actions',
          title: '操作',
          width: 250,
          render: (row: T) =>
            h(NSpace, { size: 4 }, () =>
              props.actions!(row).map(a =>
                h(
                  NButton,
                  {
                    size: 'tiny',
                    tertiary: true,
                    type: a.danger ? 'error' : 'default',
                    disabled: props.loading,
                    onClick: a.run,
                  },
                  () => a.label,
                ),
              ),
            ),
        },
      ]
    : []),
])
</script>

<template>
  <NDataTable
    :columns="columns"
    :data="rows"
    :loading="loading"
    :bordered="false"
    :single-line="false"
    :scroll-x="columns.reduce((sum, c) => sum + Number(c.width ?? 155), 0)"
    size="small"
    :pagination="paginated && rows.length > 20 ? { pageSize: 20 } : false"
  />
</template>
