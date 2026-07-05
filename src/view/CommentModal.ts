import { App, Modal } from "obsidian";

// Modal with a single-line-ish textarea for editing a per-cell trailing
// comment. Empty submit removes the comment. Works on mobile (unlike prompt).

export class CommentModal extends Modal {
	private readonly column: string;
	private readonly initial: string;
	private readonly onSubmit: (value: string) => void;

	constructor(
		app: App,
		column: string,
		initial: string,
		onSubmit: (value: string) => void
	) {
		super(app);
		this.column = column;
		this.initial = initial;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: `Comment on "${this.column}"` });
		const textarea = contentEl.createEl("textarea", {
			cls: "yt-comment-textarea",
		});
		textarea.value = this.initial;
		textarea.rows = 3;
		textarea.setAttr("placeholder", "Cell comment (emitted as # after the value)");
		textarea.focus();
		textarea.select();

		const buttons = contentEl.createDiv({ cls: "yt-modal-buttons" });
		const save = buttons.createEl("button", { cls: "mod-cta", text: "Save" });
		save.addEventListener("click", () => {
			this.onSubmit(textarea.value);
			this.close();
		});
		if (this.initial !== "") {
			const remove = buttons.createEl("button", { text: "Remove" });
			remove.addEventListener("click", () => {
				this.onSubmit("");
				this.close();
			});
		}
		const cancel = buttons.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
