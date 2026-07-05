// Per-column aggregates for the totals footer.

export interface ColumnSummary {
	numeric: boolean;
	count: number;
	sum?: number;
	avg?: number;
}

/**
 * Summarise each column across records. A column is treated as numeric only
 * when every non-empty value is a finite number; then sum and average are
 * provided. Otherwise only a non-empty count is returned.
 */
export function columnTotals(
	records: Record<string, unknown>[],
	columns: string[]
): Record<string, ColumnSummary> {
	const result: Record<string, ColumnSummary> = {};

	for (const column of columns) {
		let count = 0;
		let sum = 0;
		let numeric = true;
		let sawValue = false;

		for (const record of records) {
			const v = record[column];
			if (v === null || v === undefined || v === "") continue;
			sawValue = true;
			count++;
			if (typeof v === "number" && Number.isFinite(v)) {
				sum += v;
			} else {
				numeric = false;
			}
		}

		if (numeric && sawValue) {
			result[column] = { numeric: true, count, sum, avg: sum / count };
		} else {
			result[column] = { numeric: false, count };
		}
	}

	return result;
}
