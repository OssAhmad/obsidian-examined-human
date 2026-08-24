import { setIcon } from 'obsidian';
import type EqhCalendarPlugin from './main.ts';

export function renderDismissibleWarning(
  container: HTMLElement,
  plugin: EqhCalendarPlugin,
  key: string,
  message: string,
  className: string,
): HTMLElement | null {
  if (plugin.settings.dismissedWarningKeys.includes(key)) return null;

  const warning = container.createDiv({
    cls: `${className} eqh-dismissible-warning`,
    attr: { role: 'note' },
  });
  warning.createDiv({ cls: 'eqh-dismissible-warning-message', text: message });
  const actions = warning.createDiv({ cls: 'eqh-dismissible-warning-actions' });
  actions.createEl('button', {
    cls: 'eqh-dismissible-warning-never',
    text: "Don't show again",
    attr: { 'aria-label': `Don't show this warning again` },
  }).addEventListener('click', () => {
    void (async () => {
      if (!plugin.settings.dismissedWarningKeys.includes(key)) {
        plugin.settings.dismissedWarningKeys.push(key);
        await plugin.saveSettings();
      }
      warning.remove();
    })();
  });
  const close = actions.createEl('button', {
    cls: 'clickable-icon eqh-dismissible-warning-close',
    attr: { 'aria-label': 'Close warning', title: 'Close warning' },
  });
  setIcon(close, 'x');
  close.addEventListener('click', () => warning.remove());
  return warning;
}
