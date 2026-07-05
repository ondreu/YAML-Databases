import { App, Modal } from "obsidian";
import type { Component } from "../../model/dedupe";
import { formatScalar } from "../../model/coerce";

// A de-duplicated list of every component (record) in the database. Click one
// to insert a copy into the current table, so blocks can be reused.

export class ComponentsModal extends Modal {
	private readonly components: Component[];
	private readonly onInsert: (template: Record<string, unknown>) => void;

	constructor(
		app: App,
		components: Component[],
		onInsert: (template: Record<string, unknown>) => void
	) {
		super(app);
		this.components = components;
		this.onInsert = onInsert;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Components" });
		contentEl.createEl("p", {
			cls: "yt-modal-status",
			text: "Unique records across this database and its sub-assemblies. Insert a copy into the current table.",
		});

		const search = contentEl.createEl("input", {
			type: "text",
			cls: "yt-components-search",
			attr: { placeholder: "Filter" },
		});
		const list = contentEl.createDiv({ cls: "yt-components-list" });

		const draw = (filter: string): void => {
			list.empty();
			const q = filter.trim().toLowerCase();
			const items = this.components.filter((c) =>
				q ? this.haystack(c).includes(q) : true
			);
			if (items.length === 0) {
				list.createDiv({ cls: "yt-modal-status", text: "No components." });
				return;
			}
			for (const comp of items) {
				const row = list.createDiv({ cls: "yt-component" });
				const info = row.createDiv({ cls: "yt-component-info" });
				info.createSpan({ cls: "yt-component-label", text: comp.label });
				info.createSpan({
					cls: "yt-component-fields",
					text: this.summary(comp.template),
				});
				if (comp.count > 1) {
					row.createSpan({ cls: "yt-component-count", text: `x${comp.count}` });
				}
				const insert = row.createEl("button", { text: "Insert" });
				insert.addEventListener("click", () => {
					this.onInsert(structuredClone(comp.template));
					this.close();
				});
			}
		};

		search.addEventListener("input", () => draw(search.value));
		draw("");
	}

	private haystack(comp: Component): string {
		return (comp.label + " " + this.summary(comp.template)).toLowerCase();
	}

	private summary(template: Record<string, unknown>): string {
		return Object.keys(template)
			.map((k) => `${k}: ${formatScalar(template[k])}`)
			.join(", ");
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
