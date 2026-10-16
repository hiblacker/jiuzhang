import { inject, type ComputedRef, type InjectionKey } from 'vue'
import { dateTime } from '@/shared/lib/datetime'
export const displayTimeZoneKey: InjectionKey<ComputedRef<string>> = Symbol('display-time-zone')
export function useDisplayTime() {
  const timezone = inject(displayTimeZoneKey)
  return (value: string) => dateTime(value, timezone?.value ?? 'Asia/Shanghai')
}
