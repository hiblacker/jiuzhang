import { ref } from 'vue'
import type { FormInst } from 'naive-ui'
import { errorText } from './errors'

export function useFormSubmit(submit: () => void) {
  const form = ref<FormInst | null>(null)
  const validation = ref('')
  async function validate() {
    validation.value = ''
    try {
      await form.value?.validate()
    }
    catch {
      return
    }
    try {
      submit()
    }
    catch (error) {
      validation.value = errorText(error)
    }
  }
  return { form, validation, validate }
}

export function jsonObject(text: string, label: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(text)
  }
  catch {
    throw new Error(`${label}不是有效 JSON`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}必须为 JSON 对象`)
  }
  return value as Record<string, unknown>
}

export function columnNames(text: string): string[] {
  return text
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
}
