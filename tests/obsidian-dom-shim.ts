// Minimal re-implementation of the DOM convenience helpers Obsidian adds to
// HTMLElement, plus stubs for the few `obsidian` exports the renderers touch.
// This lets the renderers run under jsdom so we can assert what they produce.

import { JSDOM } from "jsdom";

interface ElOptions {
	cls?: string | string[];
	text?: string;
	type?: string;
	attr?: Record<string, string>;
}

export function installDom(): Document {
	const dom = new JSDOM("<!doctype html><html><body></body></html>");
	const win = dom.window as unknown as typeof globalThis & { HTMLElement: typeof HTMLElement };
	// Expose globals the renderer code may reference.
	(globalThis as Record<string, unknown>).window = win;
	(globalThis as Record<string, unknown>).document = win.document;
	(globalThis as Record<string, unknown>).HTMLElement = win.HTMLElement;

	const proto = win.HTMLElement.prototype as unknown as Record<string, unknown>;

	function createEl(
		this: HTMLElement,
		tag: string,
		options: ElOptions = {}
	): HTMLElement {
		const el = this.ownerDocument.createElement(tag);
		applyOptions(el, options);
		this.appendChild(el);
		return el;
	}

	function applyOptions(el: HTMLElement, options: ElOptions): void {
		if (options.cls) {
			const classes = Array.isArray(options.cls)
				? options.cls
				: options.cls.split(/\s+/);
			el.classList.add(...classes.filter(Boolean));
		}
		if (options.text !== undefined) {
			el.textContent = options.text;
		}
		if (options.type) {
			el.setAttribute("type", options.type);
		}
		if (options.attr) {
			for (const [k, v] of Object.entries(options.attr)) {
				el.setAttribute(k, v);
			}
		}
	}

	proto.createEl = createEl;
	proto.createDiv = function (this: HTMLElement, options?: ElOptions) {
		return createEl.call(this, "div", options);
	};
	proto.createSpan = function (this: HTMLElement, options?: ElOptions) {
		return createEl.call(this, "span", options);
	};
	proto.empty = function (this: HTMLElement) {
		while (this.firstChild) {
			this.removeChild(this.firstChild);
		}
	};
	proto.addClass = function (this: HTMLElement, ...cls: string[]) {
		this.classList.add(...cls);
	};
	proto.removeClass = function (this: HTMLElement, ...cls: string[]) {
		this.classList.remove(...cls);
	};
	proto.hasClass = function (this: HTMLElement, cls: string) {
		return this.classList.contains(cls);
	};
	proto.toggleClass = function (this: HTMLElement, cls: string, on: boolean) {
		this.classList.toggle(cls, on);
	};
	proto.setAttr = function (this: HTMLElement, k: string, v: string) {
		this.setAttribute(k, v);
	};
	proto.setText = function (this: HTMLElement, t: string) {
		this.textContent = t;
	};
	proto.hide = function (this: HTMLElement) {
		this.style.display = "none";
	};
	proto.show = function (this: HTMLElement) {
		this.style.display = "";
	};

	return win.document;
}
