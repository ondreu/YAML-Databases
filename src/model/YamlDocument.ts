import {
	parse,
	stringify,
	parseDocument,
	parseAllDocuments,
	Document,
	type ToStringOptions,
} from "yaml";

// Thin wrapper around the `yaml` library that centralises parsing and, most
// importantly, *deterministic* serialization. The whole point of the plugin is
// that a single edit produces a single-line git diff, so serialization options
// are fixed here rather than scattered across the UI.

/** Options tuned for stable, block-style, one-value-per-line output. */
const STRINGIFY_OPTIONS: ToStringOptions = {
	// Never wrap long scalars onto multiple lines — wrapping churns diffs.
	lineWidth: 0,
	// Prefer block collections over flow (`{}` / `[]`) for non-empty data.
	defaultKeyType: null,
	defaultStringType: "PLAIN",
	// Keep null explicit and quoting minimal for readable diffs.
	nullStr: "null",
};

/**
 * Per-cell comments, keyed by the *parent container* (record object or list
 * array) so they travel with the row when records are reordered or spliced.
 * The inner map is keyed by column name (for records) or stringified index
 * (for scalar list items).
 */
export type CommentMap = WeakMap<object, Map<string, string>>;

export interface ParseResult {
	/** The parsed JavaScript value (object, array, scalar, or undefined). */
	value: unknown;
	/** True if the source contained comments (not preserved on round-trip). */
	hasComments: boolean;
	/** True if the source used anchors/aliases (not preserved on round-trip). */
	hasAnchors: boolean;
}

/**
 * Parse YAML text into a plain JavaScript value and report round-trip hazards.
 * Throws on invalid YAML — callers should catch and surface the message.
 */
export function parseYaml(text: string): ParseResult {
	// Use parseDocument to inspect comments/anchors without a second parse pass.
	const doc = parseDocument(text);
	if (doc.errors.length > 0) {
		throw new Error(doc.errors[0].message);
	}
	const value = doc.toJS({ maxAliasCount: -1 }) as unknown;
	return {
		value,
		hasComments: documentHasComments(doc),
		hasAnchors: /(^|\s)[&*][A-Za-z0-9_-]+/.test(text),
	};
}

/**
 * Serialize a JavaScript value back to deterministic block-style YAML.
 * An empty document serializes to an empty string.
 */
export function serializeYaml(value: unknown): string {
	if (value === undefined) {
		return "";
	}
	return stringify(value, STRINGIFY_OPTIONS);
}

/** Parse without the round-trip diagnostics — used where only the value matters. */
export function parseYamlValue(text: string): unknown {
	return parse(text, { maxAliasCount: -1 });
}

export interface MetaParseResult extends ParseResult {
	/**
	 * Obsidian-style frontmatter: a leading `---` mapping document. Null when the
	 * file has no frontmatter block. The `value` field holds the body document.
	 */
	frontmatter: Record<string, unknown> | null;
	/**
	 * Per-cell trailing comments extracted from the source, keyed by the parent
	 * container (record object / list array) and column/index. Round-trips
	 * through `serializeYamlWithMeta`. Null only when no comments were found.
	 */
	commentMap: CommentMap | null;
}

function isPlainMap(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Ensure `map` has an inner entry for `container`, returning it. */
function cellEntries(map: CommentMap, container: object): Map<string, string> {
	let m = map.get(container);
	if (!m) {
		m = new Map();
		map.set(container, m);
	}
	return m;
}

/**
 * Walk a parsed YAML document node tree in parallel with the matching plain JS
 * value, collecting every trailing value comment (`key: value  # c`) into
 * `map`. Returns true if at least one comment was captured.
 */
function extractComments(node: unknown, js: unknown, map: CommentMap): boolean {
	let found = false;
	const n = node as {
		items?: unknown[];
		key?: { value?: unknown };
		value?: unknown;
		comment?: string | null;
	} | null;
	if (!n || typeof n !== "object") return false;

	if (n.comment && (typeof js === "string" || typeof js === "number" || typeof js === "boolean" || js === null)) {
		// A scalar list item with a trailing comment. Key by stringified index;
		// the parent array is the container. (Caller passes the array as `js`
		// wrapper — handled in the seq branch below.)
	}

	if (Array.isArray(n.items) && Array.isArray(js)) {
		for (let i = 0; i < n.items.length; i++) {
			const item = n.items[i];
			// Map item in a list of records: a Pair wrapping a YAMLMap, OR a bare scalar.
			const im = item as { value?: unknown; comment?: string | null; key?: { value?: unknown }; items?: unknown[] } | null;
			if (im && im.items && typeof js[i] === "object" && js[i] !== null) {
				// list item is a map -> recurse as map
				if (extractComments(item, js[i], map)) found = true;
			} else if (im && im.comment) {
				cellEntries(map, js).set(String(i), im.comment);
				found = true;
				if (im.value !== undefined && extractComments(im.value, (js as unknown[])[i], map)) found = true;
			} else if (im && im.value !== undefined) {
				if (extractComments(im.value, (js as unknown[])[i], map)) found = true;
			}
		}
		return found;
	}

	if (Array.isArray(n.items) && isPlainMap(js)) {
		for (const pair of n.items) {
			const p = pair as { key?: { value?: unknown }; value?: unknown };
			const key = p.key?.value;
			if (typeof key !== "string") continue;
			const v = p.value as { comment?: string | null } | null;
			if (v && v.comment) {
				cellEntries(map, js).set(key, v.comment);
				found = true;
			}
			if (v !== undefined && extractComments(v, js[key], map)) found = true;
		}
		return found;
	}

	return found;
}

/**
 * Walk a freshly created YAML document node tree in parallel with the matching
 * plain JS value, re-attaching comments from `map` onto the corresponding
 * value nodes so they serialize as `key: value  # c`.
 */
function attachComments(node: unknown, js: unknown, map: CommentMap): void {
	const n = node as {
		items?: unknown[];
		key?: { value?: unknown };
		value?: unknown;
	} | null;
	if (!n || typeof n !== "object") return;

	if (Array.isArray(n.items) && Array.isArray(js)) {
		for (let i = 0; i < n.items.length; i++) {
			const item = n.items[i];
			const im = item as { value?: unknown; items?: unknown[] } | null;
			if (im && im.items && typeof js[i] === "object" && js[i] !== null) {
				attachComments(item, js[i], map);
			} else {
				const c = map.get(js)?.get(String(i));
				const target = (im as { comment?: string }) ?? (item as { comment?: string });
				if (c && target) target.comment = c;
				if (im && im.value !== undefined) attachComments(im.value, (js as unknown[])[i], map);
			}
		}
		return;
	}

	if (Array.isArray(n.items) && isPlainMap(js)) {
		for (const pair of n.items) {
			const p = pair as { key?: { value?: unknown }; value?: { comment?: string } };
			const key = p.key?.value;
			if (typeof key !== "string") continue;
			const c = map.get(js)?.get(key);
			if (c && p.value) p.value.comment = c;
			if (p.value !== undefined) attachComments(p.value, js[key], map);
		}
		return;
	}
}

/**
 * Parse YAML that may carry an Obsidian-style frontmatter block. In a `.yaml`
 * file this is a leading document mapping fenced by `---`, followed by the body
 * document — a valid two-document YAML stream:
 *
 *     ---
 *     title: My BOM
 *     ---
 *     - part: Bolt
 *
 * When no such leading map document is present the whole file is the body and
 * `frontmatter` is null.
 */
export function parseYamlWithMeta(text: string): MetaParseResult {
	const docs = parseAllDocuments(text);
	for (const doc of docs) {
		if (doc.errors.length > 0) throw new Error(doc.errors[0].message);
	}

	if (docs.length >= 2) {
		const fm = docs[0].toJS({ maxAliasCount: -1 }) as unknown;
		if (isPlainMap(fm)) {
			const body = docs[1].toJS({ maxAliasCount: -1 }) as unknown;
			const commentMap: CommentMap = new WeakMap();
			let found = false;
			if (extractComments(docs[0].contents, fm, commentMap)) found = true;
			if (extractComments(docs[1].contents, body, commentMap)) found = true;
			return {
				value: body,
				frontmatter: fm,
				commentMap: found ? commentMap : null,
				hasComments: docs.some((d) => documentHasComments(d)),
				hasAnchors: /(^|\s)[&*][A-Za-z0-9_-]+/.test(text),
			};
		}
	}

	const single = parseYaml(text);
	const commentMap: CommentMap = new WeakMap();
	const found = extractComments(
		parseDocument(text).contents,
		single.value,
		commentMap
	);
	return { ...single, frontmatter: null, commentMap: found ? commentMap : null };
}

/** Serialize a body value together with optional frontmatter as a YAML stream. */
export function serializeYamlWithMeta(
	frontmatter: Record<string, unknown> | null,
	value: unknown,
	commentMap: CommentMap | null = null
): string {
	const body = serializeWithComments(value, commentMap);
	if (!frontmatter || Object.keys(frontmatter).length === 0) {
		return body;
	}
	const fm = serializeWithComments(frontmatter, commentMap);
	// A two-document stream: the frontmatter map, then the body. `serialize`
	// already terminates the map with a newline.
	return "---\n" + fm + "---\n" + body;
}

/** Serialize a value, re-attaching per-cell comments from `map` if present. */
function serializeWithComments(
	value: unknown,
	map: CommentMap | null
): string {
	if (value === undefined) return "";
	if (!map) return stringify(value, STRINGIFY_OPTIONS);
	const doc = new Document(value);
	attachComments(doc.contents, value, map);
	return doc.toString(STRINGIFY_OPTIONS);
}

function documentHasComments(doc: {
	commentBefore?: string | null;
	comment?: string | null;
	contents?: unknown;
}): boolean {
	if (doc.commentBefore || doc.comment) {
		return true;
	}
	let found = false;
	// Walk nodes looking for any attached comment.
	const stack: unknown[] = [doc.contents];
	while (stack.length > 0 && !found) {
		const node = stack.pop() as { comment?: string; commentBefore?: string; items?: unknown[]; value?: unknown; key?: unknown } | null;
		if (!node || typeof node !== "object") {
			continue;
		}
		if (node.comment || node.commentBefore) {
			found = true;
			break;
		}
		if (Array.isArray(node.items)) {
			stack.push(...node.items);
		}
		if (node.key !== undefined) {
			stack.push(node.key);
		}
		if (node.value !== undefined) {
			stack.push(node.value);
		}
	}
	return found;
}
