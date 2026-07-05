// Collect a de-duplicated list of "components" (records) across the whole
// database tree, so a user can reuse an existing block instead of retyping it.

import { isPlainObject } from "./shape";
import { formatScalar } from "./coerce";

export interface Component {
	/** A representative copy of the record (scalar fields only). */
	template: Record<string, unknown>;
	/** How many times an equivalent record appears in the tree. */
	count: number;
	/** A human label (value of a name-like field, else the first field). */
	label: string;
}

const NAME_KEYS = ["name", "part", "item", "component", "title", "label", "id"];

/** Pick the best label field from a record. */
function labelFor(record: Record<string, unknown>): string {
	for (const key of NAME_KEYS) {
		if (key in record && record[key] != null && record[key] !== "") {
			return formatScalar(record[key]);
		}
	}
	const first = Object.keys(record)[0];
	return first ? formatScalar(record[first]) : "(empty)";
}

/** The scalar-only projection of a record (drops nested tables/objects). */
function scalarsOf(record: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(record)) {
		const v = record[key];
		if (v === null || typeof v !== "object") {
			out[key] = v;
		}
	}
	return out;
}

/**
 * Walk the tree and return unique components (by their scalar fields), most
 * frequent first. Nested sub-tables are traversed too.
 */
export function collectComponents(root: unknown): Component[] {
	const byKey = new Map<string, Component>();

	const walk = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const item of node) {
				if (isPlainObject(item)) {
					const scalars = scalarsOf(item);
					if (Object.keys(scalars).length > 0) {
						const key = JSON.stringify(scalars);
						const existing = byKey.get(key);
						if (existing) {
							existing.count++;
						} else {
							byKey.set(key, {
								template: scalars,
								count: 1,
								label: labelFor(item),
							});
						}
					}
				}
				walk(item);
			}
			return;
		}
		if (isPlainObject(node)) {
			for (const key of Object.keys(node)) walk(node[key]);
		}
	};

	walk(root);

	return [...byKey.values()].sort(
		(a, b) => b.count - a.count || a.label.localeCompare(b.label)
	);
}
