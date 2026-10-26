/** Small Obsidian DOM double for testing confirmation controls and cancellation. */
export class TestElement {
  constructor(tag = 'div', options = {}) {
    this.tag = tag;
    this.tagName = tag.toUpperCase();
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
    this.dataset = {};
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.scrollHeight = 0;
    this.scrollWidth = 0;
    this.clientHeight = 0;
    this.clientWidth = 0;
  }
  createEl(tag, options) { const child = new TestElement(tag, options); this.appendChild(child); return child; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  addClass(value) { this.className += ` ${value}`; }
  removeClass(value) { this.className = this.className.replace(value, ''); }
  setText(value) { this.textContent = value; }
  appendText(value) { this.textContent += value; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  appendChild(child) { child.parent = this; this.children.push(child); }
  empty() { for (const element of this.children.flatMap((child) => child.all())) element.isConnected = false; this.children = []; this.scrollTop = 0; this.scrollLeft = 0; }
  remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
  querySelectorAll() { return this.children.flatMap((child) => child.all()); }
  addEventListener(name, listener) { (this.listeners[name] ??= []).push(listener); }
  trigger(name, event = {}) { for (const listener of this.listeners[name] ?? []) listener(event); }
  all() { return [this, ...this.children.flatMap((child) => child.all())]; }
  text() { return this.all().map((element) => element.textContent).join('\n'); }
}
