export type ScopedRequest = <T>(route: string, body?: unknown, csv?: boolean) => Promise<T>
