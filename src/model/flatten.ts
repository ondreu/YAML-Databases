// Flatten a hierarchical BOM into a single parts list with rolled-up
// quantities: each part's quantity is multiplied down through the sub-assembly
// tree and summed across all occurrences.

import { isPlainObject } from "./shape";
import { formatScalar } from "./coerce";

const NAME_KEYS = ["name", "part", "item", "component", "title", "label", "id"];
const QTY_KEYS = ["qty", "quantity", "count", "amount", "pcs", "number"];

function isRecords(v: unknown): v is Record<string, unknown>[] {
	return Array.isArray(v) && v.length > 0 && v.every(isPlainObject);
}

/** Detect the name and quantity columns from the top-level records. */
export function detectKeys(records: Record<string, unknown>[]): {
	nameKey: string;
	quantityKey: string | null;
} {
	const columns = new Set<string>();
	for (const r of records) for (const k of Object.keys(r)) columns.add(k);
	const find = (candidates: string[]): string | null => {
		for (const c of candidates) {
			for (const col of columns) {
				if (col.toLowerCase() === c) return col;
			}
		}
		return null;
	};
	const nameKey = find(NAME_KEYS) ?? [...columns][0] ?? "name";
	const quantityKey = find(QTY_KEYS);
	return { nameKey, quantityKey };
}

export interface FlatRow {
	name: string;
	quantity: number;
	/** Extra scalar fields carried from the first occurrence. */
	extra: Record<string, unknown>;
}

/**
 * Flatten `records` (a BOM) into aggregated rows. Every record contributes its
 * quantity times the product of its ancestors' quantities; rows are aggregated
 * by their name field.
 */
export function flattenBom(records: Record<string, unknown>[]): {
	rows: FlatRow[];
	nameKey: string;
	quantityKey: string | null;
} {
	const { nameKey, quantityKey } = detectKeys(records);
	const totals = new Map<string, FlatRow>();

	const qtyOf = (record: Record<string, unknown>): number => {
		if (!quantityKey) return 1;
		const v = record[quantityKey];
		return typeof v === "number" && Number.isFinite(v) ? v : 1;
	};

	const walk = (recs: Record<string, unknown>[], multiplier: number): void => {
		for (const record of recs) {
			const effective = multiplier * qtyOf(record);
			const name = formatScalar(record[nameKey]) || "(unnamed)";

			const existing = totals.get(name);
			if (existing) {
				existing.quantity += effective;
			} else {
				const extra: Record<string, unknown> = {};
				for (const key of Object.keys(record)) {
					if (key === nameKey || key === quantityKey) continue;
					const v = record[key];
					if (v === null || typeof v !== "object") extra[key] = v;
				}
				totals.set(name, { name, quantity: effective, extra });
			}

			// Recurse into any sub-tables, scaling by this record's effective qty.
			for (const key of Object.keys(record)) {
				const v = record[key];
				if (isRecords(v)) walk(v, effective);
			}
		}
	};

	walk(records, 1);

	const rows = [...totals.values()].sort((a, b) => a.name.localeCompare(b.name));
	return { rows, nameKey, quantityKey };
}

/** Turn flat rows into plain records for CSV/XLSX export. */
export function flatRowsToRecords(
	result: ReturnType<typeof flattenBom>
): Record<string, unknown>[] {
	const nameCol = result.nameKey || "name";
	const qtyCol = result.quantityKey || "quantity";
	return result.rows.map((row) => {
		const rec: Record<string, unknown> = { [nameCol]: row.name, [qtyCol]: row.quantity };
		for (const key of Object.keys(row.extra)) {
			if (key !== nameCol && key !== qtyCol) rec[key] = row.extra[key];
		}
		return rec;
	});
}

export { isRecords };
