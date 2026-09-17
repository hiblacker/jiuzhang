<script setup lang="ts">
import { computed, h } from 'vue';
import { NButton, NDataTable, NSpace, NTag, type DataTableColumns } from 'naive-ui';
import { display, type Action, type Column, type Row } from '../types';
const props = withDefaults(
  defineProps<{
    rows: Row[];
    columns: Column[];
    actions?: (row: Row) => Action[];
    loading?: boolean;
    paginated?: boolean;
  }>(),
  { paginated: true, actions: undefined },
);
const positive = ['COMPLETE', 'ACTIVE', 'RAW_COMMITTED', 'PARSED', 'READY', 'PUBLISHED', 'RECEIVED'];
const negative = ['FAILED', 'MISSING', 'OVERDUE', 'REJECTED', 'INCOMPLETE'];
const columns = computed<DataTableColumns<Row>>(() => [
  ...props.columns.map((c) => ({
    key: c.key,
    title: c.title,
    width: c.width ?? 155,
    ellipsis: { tooltip: true },
    render: (row: Row) =>
      c.state
        ? h(
            NTag,
            {
              size: 'small',
              bordered: false,
              type: positive.includes(String(row[c.key]))
                ? 'success'
                : negative.includes(String(row[c.key]))
                  ? 'error'
                  : 'default',
            },
            () => display(row[c.key]),
          )
        : display(row[c.key]),
  })),
  ...(props.actions
    ? [
        {
          key: '_actions',
          title: '操作',
          width: 250,
          render: (row: Row) =>
            h(NSpace, { size: 4 }, () =>
              props.actions!(row).map((a) =>
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
]);
</script>

<template>
  <n-data-table
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
