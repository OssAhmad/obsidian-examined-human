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
  constructor(leaf) { super(leaf.app); this.contentEl = new TestElement(); }
}
export class WorkspaceLeaf {}
export class PluginSettingTab {}
export class Setting {}
export const Platform = { isDesktopApp: true };
export function moment(value) { return { format: () => value ?? '2026-08-22' }; }
export function setIcon() {}
