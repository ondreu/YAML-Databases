import { App, Modal } from "obsidian";
import { flattenBom, flatRowsToRecords } from "../../model/flatten";
import { collectColumns } from "../../model/shape";
import { formatScalar } from "../../model/coerce";

// Show a flattened BOM (rolled-up quantities across sub-assemblies) with export
// buttons. Export is delegated so the view can write a sibling file.

export class FlattenModal extends Modal {
	private readonly records: Record<string, unknown>[];
	private readonly onExport: (
		records: Record<string, unknown>[],
		columns: string[],
		kind: "csv" | "xlsx"
	) => void;

	constructor(
		app: App,
		records: Record<string, unknown>[],
		onExport: (
			r: Record<string, unknown>[],
			c: string[],
			kind: "csv" | "xlsx"
		) => void
	) {
		super(app);
		this.records = records;
		this.onExport = onExport;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("yt-flatten-modal");
		contentEl.createEl("h3", { text: "Flattened BOM" });

		const flat = flattenBom(this.records);
		const rows = flatRowsToRecords(flat);
		const columns = collectColumns(rows);

		contentEl.createEl("p", {
			cls: "yt-modal-status",
			text: `${rows.length} unique part(s), quantities rolled up through sub-assemblies.`,
		});

		const wrap = contentEl.createDiv({ cls: "yt-flatten-wrap" });
		const table = wrap.createEl("table", { cls: "yt-flatten-table" });
		const head = table.createEl("thead").createEl("tr");
		for (const c of columns) head.createEl("th", { text: c });
		const body = table.createEl("tbody");
		for (const rec of rows) {
			const tr = body.createEl("tr");
			for (const c of columns) {
				tr.createEl("td", { text: formatScalar(rec[c]) });
			}
		}

		const buttons = contentEl.createDiv({ cls: "yt-modal-buttons" });
		const csv = buttons.createEl("button", { cls: "mod-cta", text: "Export CSV" });
		csv.addEventListener("click", () => this.onExport(rows, columns, "csv"));
		const xlsx = buttons.createEl("button", { text: "Export XLSX" });
		xlsx.addEventListener("click", () => this.onExport(rows, columns, "xlsx"));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
