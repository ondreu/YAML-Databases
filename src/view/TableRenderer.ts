import { Menu } from "obsidian";
import { Renderer } from "./Renderer";
import { collectColumns, isPlainObject } from "../model/shape";
import { coerceScalar, formatScalar, isEditableScalar } from "../model/coerce";

// A spreadsheet-style editor for a list of records: row numbers down the side,
// a sticky header of column names, one editable cell per field. It behaves like
// a real sheet — Tab/Enter/arrows move between cells and edits never re-render
// the grid (so focus is never lost while typing).
//
// The model is a `Record<string, unknown>[]`. Columns are the ordered union of
// keys across rows; a missing key renders as an empty cell.

/** Cell to focus after the next render (set before a structural change). */
interface FocusTarget {
	row: number;
	col: number;
	/** Put the caret at the end and select nothing. */
	select?: boolean;
}

export class TableRenderer extends Renderer {
	private pendingFocus: FocusTarget | null = null;

	render(): void {
		this.container.empty();
		const data = this.host.getData();

		if (!Array.isArray(data) || (data.length > 0 && !data.every(isPlainObject))) {
			this.renderNotRecords(data);
			return;
		}

		const records = data as Record<string, unknown>[];
		const columns = collectColumns(records);

		const scroll = this.container.createDiv({ cls: "yt-sheet-scroll" });
		const table = scroll.createEl("table", { cls: "yt-sheet" });

		this.renderHead(table, records, columns);
		this.renderBody(table, records, columns);

		this.applyPendingFocus();
	}

	// --- Header ----------------------------------------------------------

	private renderHead(
		table: HTMLTableElement,
		records: Record<string, unknown>[],
		columns: string[]
	): void {
		const thead = table.createEl("thead");
		const tr = thead.createEl("tr");

		// Top-left corner cell (aligns with the row-number gutter).
		tr.createEl("th", { cls: "yt-corner" });

		columns.forEach((column, colIndex) => {
			const th = tr.createEl("th", { cls: "yt-colhead" });
			const label = th.createEl("input", {
				cls: "yt-colhead-input",
				attr: { value: column, spellcheck: "false" },
			});
			label.value = column;

			// Rename on commit; ignore no-ops and collisions.
			label.addEventListener("blur", () =>
				this.commitRename(column, label.value)
			);
			label.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter") {
					evt.preventDefault();
					label.blur();
				} else if (evt.key === "Escape") {
					label.value = column;
					label.blur();
				}
			});
			th.addEventListener("contextmenu", (evt) =>
				this.openColumnMenu(evt, column, colIndex, columns)
			);
		});

		// "Add column" affordance at the right edge.
		const addTh = tr.createEl("th", { cls: "yt-addcol", text: "+" });
		addTh.setAttr("aria-label", "Add column");
		addTh.addEventListener("click", () => this.addColumn(records, columns));
	}

	// --- Body ------------------------------------------------------------

	private renderBody(
		table: HTMLTableElement,
		records: Record<string, unknown>[],
		columns: string[]
	): void {
		const tbody = table.createEl("tbody");

		records.forEach((record, rowIndex) => {
			const tr = tbody.createEl("tr");

			const gutter = tr.createEl("th", {
				cls: "yt-rownum",
				text: String(rowIndex + 1),
			});
			gutter.setAttr("aria-label", `Row ${rowIndex + 1}`);
			gutter.addEventListener("click", (evt) =>
				this.openRowMenu(evt, rowIndex, records)
			);

			columns.forEach((column, colIndex) => {
				const td = tr.createEl("td", { cls: "yt-cell" });
				this.renderCell(td, record, column, rowIndex, colIndex, columns.length);
			});

			// Trailing spacer cell so the "+ column" column has a body.
			tr.createEl("td", { cls: "yt-cell yt-cell-spacer" });
		});

		// "Add row" footer.
		const footer = tbody.createEl("tr", { cls: "yt-addrow" });
		const cell = footer.createEl("td", {
			cls: "yt-addrow-cell",
			text: "+ Add row",
			attr: { colspan: String(columns.length + 2) },
		});
		cell.addEventListener("click", () => this.addRow(records, columns));
	}

	private renderCell(
		td: HTMLElement,
		record: Record<string, unknown>,
		column: string,
		rowIndex: number,
		colIndex: number,
		colCount: number
	): void {
		const value = record[column];

		if (!isEditableScalar(value)) {
			td.addClass("yt-cell-readonly");
			td.createSpan({ cls: "yt-cell-nested", text: formatScalar(value) });
			return;
		}

		if (typeof value === "boolean") {
			const box = td.createEl("input", {
				type: "checkbox",
				cls: "yt-cell-checkbox",
			});
			box.checked = value;
			box.dataset.row = String(rowIndex);
			box.dataset.col = String(colIndex);
			box.addEventListener("change", () => {
				record[column] = box.checked;
				this.host.touch();
			});
			this.wireNavigation(box, rowIndex, colIndex, colCount);
			return;
		}

		const input = td.createEl("input", {
			type: "text",
			cls: "yt-cell-input",
			attr: { spellcheck: "false" },
		});
		input.value = formatScalar(value);
		input.dataset.row = String(rowIndex);
		input.dataset.col = String(colIndex);

		// Commit on change only; never re-render here, so typing keeps focus.
		input.addEventListener("change", () => {
			record[column] = coerceScalar(input.value);
			this.host.touch();
		});
		this.wireNavigation(input, rowIndex, colIndex, colCount);
	}

	// --- Keyboard navigation --------------------------------------------

	private wireNavigation(
		el: HTMLElement,
		rowIndex: number,
		colIndex: number,
		colCount: number
	): void {
		el.addEventListener("keydown", (evt: KeyboardEvent) => {
			switch (evt.key) {
				case "Enter":
					evt.preventDefault();
					this.moveFocus(rowIndex + (evt.shiftKey ? -1 : 1), colIndex);
					break;
				case "ArrowDown":
					evt.preventDefault();
					this.moveFocus(rowIndex + 1, colIndex);
					break;
				case "ArrowUp":
					evt.preventDefault();
					this.moveFocus(rowIndex - 1, colIndex);
					break;
				case "Tab":
					// Let the browser handle Tab, but wrap at row ends by nudging
					// focus to the next/previous row's edge cell.
					if (!evt.shiftKey && colIndex === colCount - 1) {
						evt.preventDefault();
						this.moveFocus(rowIndex + 1, 0);
					} else if (evt.shiftKey && colIndex === 0) {
						evt.preventDefault();
						this.moveFocus(rowIndex - 1, colCount - 1);
					}
					break;
				case "Escape":
					(el as HTMLInputElement).blur();
					break;
			}
		});
	}

	private moveFocus(row: number, col: number): void {
		const target = this.container.querySelector<HTMLInputElement>(
			`[data-row="${row}"][data-col="${col}"]`
		);
		if (target) {
			target.focus();
			if (target.type === "text") {
				target.select();
			}
		}
	}

	// --- Structural operations ------------------------------------------

	/** Seed a brand-new document with one row and one editable column. */
	private startFirstTable(): void {
		this.pendingFocus = { row: 0, col: 0 };
		this.host.replaceData([{ "field 1": null }]);
	}

	private addRow(records: Record<string, unknown>[], columns: string[]): void {
		const row: Record<string, unknown> = {};
		for (const column of columns) {
			row[column] = null;
		}
		records.push(row);
		this.pendingFocus = { row: records.length - 1, col: 0 };
		this.host.replaceData(records);
	}

	private addColumn(
		records: Record<string, unknown>[],
		columns: string[]
	): void {
		const name = this.uniqueColumnName(columns);
		if (records.length === 0) {
			records.push({ [name]: null });
		} else {
			for (const record of records) {
				record[name] = null;
			}
		}
		// Focus the new column header for immediate renaming.
		this.pendingFocus = { row: -1, col: columns.length };
		this.host.replaceData(records);
	}

	private commitRename(from: string, to: string): void {
		const next = to.trim();
		if (!next || next === from) {
			return;
		}
		const records = this.host.getData() as Record<string, unknown>[];
		// Reject a rename that would collide with another existing column.
		const columns = collectColumns(records);
		if (columns.includes(next)) {
			// Name already taken; revert by re-rendering with the old name.
			this.host.rerender();
			return;
		}
		for (const record of records) {
			if (!(from in record)) {
				continue;
			}
			const rebuilt: Record<string, unknown> = {};
			for (const key of Object.keys(record)) {
				rebuilt[key === from ? next : key] = record[key];
			}
			this.replaceKeys(record, rebuilt);
		}
		this.host.replaceData(records);
	}

	private deleteColumn(column: string): void {
		const records = this.host.getData() as Record<string, unknown>[];
		for (const record of records) {
			delete record[column];
		}
		this.host.replaceData(records);
	}

	private moveColumn(columns: string[], from: number, to: number): void {
		if (to < 0 || to >= columns.length) {
			return;
		}
		const order = [...columns];
		const [moved] = order.splice(from, 1);
		order.splice(to, 0, moved);
		const records = this.host.getData() as Record<string, unknown>[];
		for (const record of records) {
			const rebuilt: Record<string, unknown> = {};
			for (const key of order) {
				if (key in record) {
					rebuilt[key] = record[key];
				}
			}
			for (const key of Object.keys(record)) {
				if (!(key in rebuilt)) {
					rebuilt[key] = record[key];
				}
			}
			this.replaceKeys(record, rebuilt);
		}
		this.pendingFocus = { row: -1, col: to };
		this.host.replaceData(records);
	}

	private insertRow(records: Record<string, unknown>[], at: number): void {
		const columns = collectColumns(records);
		const row: Record<string, unknown> = {};
		for (const column of columns) {
			row[column] = null;
		}
		records.splice(at, 0, row);
		this.pendingFocus = { row: at, col: 0 };
		this.host.replaceData(records);
	}

	private moveRow(
		records: Record<string, unknown>[],
		from: number,
		to: number
	): void {
		if (to < 0 || to >= records.length) {
			return;
		}
		const [moved] = records.splice(from, 1);
		records.splice(to, 0, moved);
		this.host.replaceData(records);
	}

	// --- Context menus ---------------------------------------------------

	private openColumnMenu(
		evt: MouseEvent,
		column: string,
		colIndex: number,
		columns: string[]
	): void {
		evt.preventDefault();
		const menu = new Menu();
		menu.addItem((i) =>
			i
				.setTitle("Insert column left")
				.setIcon("arrow-left")
				.onClick(() => this.insertColumn(columns, colIndex))
		);
		menu.addItem((i) =>
			i
				.setTitle("Insert column right")
				.setIcon("arrow-right")
				.onClick(() => this.insertColumn(columns, colIndex + 1))
		);
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle("Move left")
				.setIcon("chevron-left")
				.setDisabled(colIndex <= 0)
				.onClick(() => this.moveColumn(columns, colIndex, colIndex - 1))
		);
		menu.addItem((i) =>
			i
				.setTitle("Move right")
				.setIcon("chevron-right")
				.setDisabled(colIndex >= columns.length - 1)
				.onClick(() => this.moveColumn(columns, colIndex, colIndex + 1))
		);
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle("Delete column")
				.setIcon("trash")
				.onClick(() => this.deleteColumn(column))
		);
		menu.showAtMouseEvent(evt);
	}

	private openRowMenu(
		evt: MouseEvent,
		rowIndex: number,
		records: Record<string, unknown>[]
	): void {
		evt.preventDefault();
		const menu = new Menu();
		menu.addItem((i) =>
			i
				.setTitle("Insert row above")
				.setIcon("arrow-up")
				.onClick(() => this.insertRow(records, rowIndex))
		);
		menu.addItem((i) =>
			i
				.setTitle("Insert row below")
				.setIcon("arrow-down")
				.onClick(() => this.insertRow(records, rowIndex + 1))
		);
		menu.addItem((i) =>
			i
				.setTitle("Duplicate row")
				.setIcon("copy")
				.onClick(() => {
					records.splice(rowIndex + 1, 0, { ...records[rowIndex] });
					this.host.replaceData(records);
				})
		);
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle("Move up")
				.setIcon("chevron-up")
				.setDisabled(rowIndex <= 0)
				.onClick(() => this.moveRow(records, rowIndex, rowIndex - 1))
		);
		menu.addItem((i) =>
			i
				.setTitle("Move down")
				.setIcon("chevron-down")
				.setDisabled(rowIndex >= records.length - 1)
				.onClick(() => this.moveRow(records, rowIndex, rowIndex + 1))
		);
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle("Delete row")
				.setIcon("trash")
				.onClick(() => {
					records.splice(rowIndex, 1);
					this.host.replaceData(records);
				})
		);
		menu.showAtMouseEvent(evt);
	}

	private insertColumn(columns: string[], at: number): void {
		const name = this.uniqueColumnName(columns);
		const order = [...columns];
		order.splice(at, 0, name);
		const records = this.host.getData() as Record<string, unknown>[];
		if (records.length === 0) {
			records.push({ [name]: null });
		} else {
			for (const record of records) {
				const rebuilt: Record<string, unknown> = {};
				for (const key of order) {
					rebuilt[key] = key === name ? null : record[key];
				}
				this.replaceKeys(record, rebuilt);
			}
		}
		this.pendingFocus = { row: -1, col: at };
		this.host.replaceData(records);
	}

	// --- Helpers ---------------------------------------------------------

	private uniqueColumnName(columns: string[]): string {
		const existing = new Set(columns);
		for (let i = 1; i < 1000; i++) {
			const name = `field ${i}`;
			if (!existing.has(name)) {
				return name;
			}
		}
		return `field ${Date.now()}`;
	}

	/** Replace all keys of `record` in place with those of `rebuilt`. */
	private replaceKeys(
		record: Record<string, unknown>,
		rebuilt: Record<string, unknown>
	): void {
		for (const key of Object.keys(record)) {
			delete record[key];
		}
		Object.assign(record, rebuilt);
	}

	private applyPendingFocus(): void {
		const target = this.pendingFocus;
		this.pendingFocus = null;
		if (!target) {
			return;
		}
		if (target.row === -1) {
			// Focus a column header input.
			const heads = this.container.querySelectorAll<HTMLInputElement>(
				".yt-colhead-input"
			);
			heads.item(target.col)?.focus();
			heads.item(target.col)?.select();
			return;
		}
		this.moveFocus(target.row, target.col);
	}

	private renderNotRecords(data: unknown): void {
		const empty = this.container.createDiv({ cls: "yt-empty" });
		const isEmptyDoc =
			data === undefined ||
			data === null ||
			(Array.isArray(data) && data.length === 0);

		if (isEmptyDoc) {
			empty.createDiv({ cls: "yt-empty-title", text: "Empty database" });
			empty.createDiv({
				cls: "yt-empty-subtitle",
				text: "Add the first row to start a table.",
			});
			const start = empty.createEl("button", {
				cls: "yt-btn",
				text: "+ Add row",
			});
			start.addEventListener("click", () => this.startFirstTable());
			return;
		}

		empty.createDiv({
			cls: "yt-empty-title",
			text: "This file is not a list of records",
		});
		empty.createDiv({
			cls: "yt-empty-subtitle",
			text: "The table view shows a list of objects. Use the Form or Source view for this file.",
		});
	}
}
