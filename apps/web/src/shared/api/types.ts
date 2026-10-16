import type { components } from '@jiuzhang/contracts'
export type Model<K extends keyof components['schemas']> = components['schemas'][K]
