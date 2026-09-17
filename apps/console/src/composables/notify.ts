import { createDiscreteApi } from 'naive-ui';
import { dateZhCN, zhCN } from 'naive-ui';

type MessageApi = ReturnType<typeof createDiscreteApi>['message'];

let message: MessageApi | null = null;

/**
 * Transient feedback goes through the UI library's message toasts instead of boxes inside the page,
 * so a failure never shifts the layout and no page has to keep an alert around. The API is created
 * lazily and falls back to the console when there is no DOM (unit tests import the same modules).
 */
function api(): MessageApi | null {
  if (typeof document === 'undefined') return null;
  message ??= createDiscreteApi(['message'], { configProviderProps: { locale: zhCN, dateLocale: dateZhCN } }).message;
  return message;
}

function report(level: 'error' | 'success' | 'warning' | 'info', input: unknown) {
  const text = typeof input === 'string' ? input : input instanceof Error ? input.message : String(input);
  const instance = api();
  if (!instance) {
    console.warn(`[notify:${level}] ${text}`);
    return;
  }
  instance[level](text, { duration: level === 'error' ? 5000 : 3000, keepAliveOnHover: true });
}

export const notify = {
  error: (input: unknown) => report('error', input),
  success: (input: unknown) => report('success', input),
  warning: (input: unknown) => report('warning', input),
  info: (input: unknown) => report('info', input),
};
