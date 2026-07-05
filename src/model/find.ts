// Find & replace across a whole YAML database, including nested sub-tables.
// Operates on string cell values (replacing a number/boolean would change its
// type), walking every records array in the tree.

import { isPlainObject } from "./shape";

export interface FindOptions {
	query: string;
	/** Restrict to a single column name; null/undefined = all columns. */
	column?: string | null;
	caseSensitive?: boolean;
	/** Match only when the whole cell equals the query. */
	wholeCell?: boolean;
}

/** Count how many string cells match the query. */
export function countMatches(root: unknown, opts: FindOptions): number {
	let count = 0;
	walkStrings(root, opts, () => {
		count++;
		return undefined; // no replacement
	});
	return count;
}

/**
 * Replace matches in place. Returns the number of cells changed. With
 * `wholeCell`, a matching cell becomes `replacement`; otherwise every
 * occurrence of the query substring within the cell is replaced.
 */
export function replaceAll(
	root: unknown,
	opts: FindOptions,
	replacement: string
): number {
	let changed = 0;
	walkStrings(root, opts, (value) => {
		if (opts.wholeCell) {
			changed++;
			return replacement;
		}
		const next = replaceSubstring(value, opts.query, replacement, !!opts.caseSensitive);
		if (next !== value) changed++;
		return next;
	});
	return changed;
}

/**
 * Visit every string cell that matches. `visit` may return a replacement
 * string; when it does and it differs, the cell is updated in place.
 */
function walkStrings(
	node: unknown,
	opts: FindOptions,
	visit: (value: string) => string | undefined
): void {
	if (Array.isArray(node)) {
		for (const item of node) walkStrings(item, opts, visit);
		return;
	}
	if (!isPlainObject(node)) return;
	for (const key of Object.keys(node)) {
		const value = node[key];
		if (typeof value === "string") {
			if (opts.column && key !== opts.column) continue;
			if (matches(value, opts)) {
				const next = visit(value);
				if (next !== undefined && next !== value) {
					node[key] = next;
				}
			}
		} else if (value && typeof value === "object") {
			walkStrings(value, opts, visit);
		}
	}
}

function matches(value: string, opts: FindOptions): boolean {
	if (opts.query === "") return false;
	const a = opts.caseSensitive ? value : value.toLowerCase();
	const q = opts.caseSensitive ? opts.query : opts.query.toLowerCase();
	return opts.wholeCell ? a === q : a.includes(q);
}

function replaceSubstring(
	value: string,
	query: string,
	replacement: string,
	caseSensitive: boolean
): string {
	if (query === "") return value;
	if (caseSensitive) {
		return value.split(query).join(replacement);
	}
	// Case-insensitive substring replace without regex escaping issues.
	let result = "";
	let i = 0;
	const lower = value.toLowerCase();
	const q = query.toLowerCase();
	while (i < value.length) {
		if (lower.startsWith(q, i)) {
			result += replacement;
			i += query.length;
		} else {
			result += value[i];
			i++;
		}
	}
	return result;
}
