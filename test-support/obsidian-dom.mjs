/** Small Obsidian DOM double for testing confirmation controls and cancellation. */
export class TestElement {
  constructor(tag = 'div', options = {}) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.className = options.cls ?? '';
    this.textContent = options.text ?? '';
    this.attributes = { ...options.attr };
    this.type = options.type;
    this.style = { setProperty() {} };
    this.checked = false;
    this.disabled = false;
    this.isConnected = true;
  }
  createEl(tag, options) { const child = new TestElement(tag, options); this.children.push(child); return child; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  addClass(value) { this.className += ` ${value}`; }
  removeClass(value) { this.className = this.className.replace(value, ''); }
  setText(value) { this.textContent = value; }
  appendText(value) { this.textContent += value; }
  setAttribute(name, value) { this.attributes[name] = value; }
  appendChild(child) { this.children.push(child); }
  empty() { this.children = []; }
  addEventListener(name, listener) { (this.listeners[name] ??= []).push(listener); }
  trigger(name) { for (const listener of this.listeners[name] ?? []) listener({}); }
  all() { return [this, ...this.children.flatMap((child) => child.all())]; }
  text() { return this.all().map((element) => element.textContent).join('\n'); }
}
