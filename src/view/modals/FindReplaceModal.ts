import { App, Modal, Setting } from "obsidian";
import type { FindOptions } from "../../model/find";

// Find & replace across the whole database (including sub-tables). The caller
// supplies count/replace callbacks that operate on the model.

export class FindReplaceModal extends Modal {
	private query = "";
	private replacement = "";
	private column: string | null = null;
	private caseSensitive = false;
	private wholeCell = false;

	private readonly columns: string[];
	private readonly onCount: (opts: FindOptions) => number;
	private readonly onReplace: (opts: FindOptions, replacement: string) => number;
	private statusEl!: HTMLElement;

	constructor(
		app: App,
		columns: string[],
		onCount: (opts: FindOptions) => number,
		onReplace: (opts: FindOptions, replacement: string) => number
	) {
		super(app);
		this.columns = columns;
		this.onCount = onCount;
		this.onReplace = onReplace;
	}

	private opts(): FindOptions {
		return {
			query: this.query,
			column: this.column,
			caseSensitive: this.caseSensitive,
			wholeCell: this.wholeCell,
		};
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Find & replace" });

		new Setting(contentEl).setName("Find").addText((t) => {
			t.setPlaceholder("Text to find").onChange((v) => {
				this.query = v;
				this.refreshCount();
			});
			t.inputEl.focus();
		});

		new Setting(contentEl)
			.setName("Replace with")
			.addText((t) => t.onChange((v) => (this.replacement = v)));

		new Setting(contentEl).setName("Column").addDropdown((d) => {
			d.addOption("", "All columns");
			for (const c of this.columns) d.addOption(c, c);
			d.onChange((v) => {
				this.column = v || null;
				this.refreshCount();
			});
		});

		new Setting(contentEl)
			.setName("Case sensitive")
			.addToggle((t) =>
				t.onChange((v) => {
					this.caseSensitive = v;
					this.refreshCount();
				})
			);

		new Setting(contentEl)
			.setName("Match whole cell")
			.addToggle((t) =>
				t.onChange((v) => {
					this.wholeCell = v;
					this.refreshCount();
				})
			);

		this.statusEl = contentEl.createDiv({ cls: "yt-modal-status" });

		const buttons = contentEl.createDiv({ cls: "yt-modal-buttons" });
		const replace = buttons.createEl("button", {
			cls: "mod-cta",
			text: "Replace all",
		});
		replace.addEventListener("click", () => {
			if (!this.query) return;
			const n = this.onReplace(this.opts(), this.replacement);
			this.statusEl.setText(`Replaced ${n} cell(s).`);
		});
		const close = buttons.createEl("button", { text: "Close" });
		close.addEventListener("click", () => this.close());

		this.refreshCount();
	}

	private refreshCount(): void {
		if (!this.query) {
			this.statusEl.setText("");
			return;
		}
		this.statusEl.setText(`${this.onCount(this.opts())} match(es).`);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
