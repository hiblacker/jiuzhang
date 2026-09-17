import { ref, useId } from 'vue';

export function useTabs(initial: string) {
  const activeTab = ref(initial);
  const prefix = useId();
  function tabProps(name: string) {
    return {
      id: `${prefix}-tab-${name}`,
      role: 'tab',
      tabindex: activeTab.value === name ? 0 : -1,
      'aria-selected': activeTab.value === name,
      'aria-controls': `${prefix}-panel-${name}`,
      onKeydown(event: KeyboardEvent) {
        const current = event.currentTarget as HTMLElement;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          current.click();
          return;
        }
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const tabs = Array.from(current.closest('.n-tabs-nav')?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
        if (!tabs.length) return;
        const index = tabs.indexOf(current);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        event.preventDefault();
        tabs[next]!.focus();
        tabs[next]!.click();
      },
    };
  }
  function panelProps(name: string) {
    return { id: `${prefix}-panel-${name}`, role: 'tabpanel', 'aria-labelledby': `${prefix}-tab-${name}` };
  }
  return { activeTab, tabProps, panelProps };
}
