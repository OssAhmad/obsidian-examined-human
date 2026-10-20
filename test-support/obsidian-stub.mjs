import { TestElement } from './obsidian-dom.mjs';

export class App {}
export class TFile {
  constructor(path) { this.path = path; this.name = path.split('/').at(-1); }
}
export class TFolder {
  constructor(path) { this.path = path; }
}
export function normalizePath(path) { return path.replace(/\\/g, '/'); }

export class Modal {
  static opened = null;
  constructor(app) { this.app = app; this.contentEl = new TestElement(); this.modalEl = new TestElement(); }
  open() { Modal.opened = this; this.onOpen(); }
  close() { this.onClose(); }
}
export class Notice {
  static messages = [];
  constructor(message) { Notice.messages.push(message); }
}
export class Plugin {
  constructor(app) { this.app = app; }
}
export class ItemView extends Plugin {
  constructor(leaf) { super(leaf.app); this.containerEl = new TestElement(); this.contentEl = this.containerEl.createDiv(); }
}
export class WorkspaceLeaf {}
export class PluginSettingTab {}
export class Setting {}
export const Platform = { isDesktopApp: true };
export function moment(value) {
  const date = new Date(`${value ?? '2026-08-22'}T00:00:00Z`);
  const result = {
    format: () => date.toISOString().slice(0, 10),
    clone: () => moment(result.format()),
    startOf: () => result,
    add: (amount) => { date.setUTCDate(date.getUTCDate() + amount); return result; },
    subtract: (amount) => result.add(-amount),
    diff: (other) => Math.round((date - new Date(`${other.format()}T00:00:00Z`)) / 86400000),
    isSameOrBefore: (other) => result.diff(other) <= 0,
    isValid: () => Number.isFinite(date.getTime()),
    year: () => date.getUTCFullYear(),
    month: () => date.getUTCMonth(),
  };
  return result;
}
export function setIcon() {}
