export function dateTime(value: string, timeZone = 'Asia/Shanghai') {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
export function count(value: number | string) {
  return new Intl.NumberFormat('zh-CN').format(BigInt(value))
}
