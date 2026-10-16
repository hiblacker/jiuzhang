<script setup lang="ts">
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

import { computed, h } from 'vue'
import {
  NDataTable,
  NInput,
  NSelect,
  NCheckbox,
  NButton,
  NSpace,
  type DataTableColumns,
} from 'naive-ui'
import type { Model } from '@/shared/api/types'
const model = defineModel<Model<'Field'>[]>({ required: true })
const props = defineProps<{ readonly?: boolean; policies?: { label: string; value: string }[] }>()
function change(index: number, patch: Partial<Model<'Field'>>) {
  model.value = model.value.map((f, i) => (i === index ? { ...f, ...patch } : f))
}
function addField() {
  model.value = [
    ...model.value,
    {
      name: '',
      target: '',
      type: 'string',
      nullable: true,
      output: true,
      sensitive: false,
      maskPolicyId: '',
      description: '',
    },
  ]
}
function move(index: number, offset: number) {
  const destination = index + offset
  if (destination < 0 || destination >= model.value.length) return
  const fields = [...model.value]
  const [field] = fields.splice(index, 1)
  fields.splice(destination, 0, field!)
  model.value = fields
}
const columns = computed<DataTableColumns<Model<'Field'>>>(() => [
  {
    title: uiText('actions'),
    key: 'remove',
    width: 80,
    render: (row, index) =>
      h(
        NButton,
        {
          size: 'small',
          disabled: props.readonly,
          'aria-label': uiText('datasets.removeField', { name: row.name }),
          onClick: () => {
            model.value = model.value.filter((_field, i) => i !== index)
          },
        },
        () => uiText('delete'),
      ),
  },
  {
    title: uiText('ui.dataset_fields_8e321432'),
    key: 'name',
    width: 170,
    render: (row, index) =>
      h(NInput, {
        value: row.name,
        disabled: props.readonly,
        size: 'small',
        inputProps: { 'aria-label': uiText('datasets.fieldName') },
        'onUpdate:value': (value) => change(index, { name: value }),
      }),
  },
  {
    title: uiText('datasets.fieldOrder'),
    key: 'order',
    width: 130,
    render: (_row, index) =>
      h(NSpace, {}, () => [
        h(
          NButton,
          { size: 'tiny', disabled: props.readonly || index === 0, onClick: () => move(index, -1) },
          () => uiText('datasets.moveUp'),
        ),
        h(
          NButton,
          {
            size: 'tiny',
            disabled: props.readonly || index === model.value.length - 1,
            onClick: () => move(index, 1),
          },
          () => uiText('datasets.moveDown'),
        ),
      ]),
  },
  {
    title: uiText('ui.dataset_fields_68ad8534'),
    key: 'target',
    minWidth: 140,
    render: (row, index) =>
      h(NInput, {
        value: row.target,
        disabled: props.readonly,
        size: 'small',
        inputProps: { 'aria-label': uiText('ui.dataset_fields_ea107d2a') + row.name },
        'onUpdate:value': (value) => change(index, { target: value }),
      }),
  },
  {
    title: uiText('ui.dataset_fields_e4e46c72'),
    key: 'type',
    width: 140,
    render: (row, index) =>
      h(NSelect, {
        value: row.type,
        disabled: props.readonly,
        size: 'small',
        options: ['string', 'integer', 'decimal(18,2)', 'boolean', 'date'].map((value) => ({
          label: value,
          value,
        })),
        'onUpdate:value': (value) => change(index, { type: value }),
      }),
  },
  {
    title: uiText('description'),
    key: 'description',
    width: 180,
    render: (row, index) =>
      h(NInput, {
        value: row.description,
        disabled: props.readonly,
        size: 'small',
        inputProps: { 'aria-label': uiText('description') + row.name },
        'onUpdate:value': (value) => change(index, { description: value }),
      }),
  },
  {
    title: uiText('ui.dataset_fields_ded698ae'),
    key: 'output',
    width: 70,
    render: (row, index) =>
      h(NCheckbox, {
        checked: row.output,
        disabled: props.readonly,
        'aria-label': uiText('ui.dataset_fields_8fd01560') + row.name,
        'onUpdate:checked': (value) => change(index, { output: value }),
      }),
  },
  {
    title: uiText('nullable'),
    key: 'nullable',
    width: 90,
    render: (row, index) =>
      h(NCheckbox, {
        checked: row.nullable,
        disabled: props.readonly,
        'aria-label': uiText('datasets.nullableField', { name: row.name }),
        'onUpdate:checked': (value) => change(index, { nullable: value }),
      }),
  },
  {
    title: uiText('ui.dataset_fields_e4d1f069'),
    key: 'sensitive',
    width: 70,
    render: (row, index) =>
      h(NCheckbox, {
        checked: row.sensitive,
        disabled: props.readonly,
        'aria-label': uiText('ui.dataset_fields_1e6e7152') + row.name,
        'onUpdate:checked': (value) => change(index, { sensitive: value }),
      }),
  },
  {
    title: uiText('ui.dataset_fields_0549993d'),
    key: 'maskPolicyId',
    width: 170,
    render: (row, index) =>
      h(NSelect, {
        value: row.maskPolicyId || null,
        disabled: props.readonly,
        clearable: true,
        size: 'small',
        options: props.policies ?? [],
        'onUpdate:value': (value) => change(index, { maskPolicyId: value ?? '' }),
      }),
  },
])
</script>
<template>
  <NButton v-if="!readonly" class="mb" @click="addField">{{ uiText('datasets.addField') }}</NButton>
  <NDataTable :data="model" :columns="columns" :bordered="false" :scroll-x="1270" />
</template>
