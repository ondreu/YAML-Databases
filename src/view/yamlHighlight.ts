// A tiny, dependency-free YAML syntax highlighter for the Source view. It
// builds DOM nodes rendered in a layer *behind* a transparent textarea, so the
// output must reproduce every input character exactly (same length per line) or
// the caret would drift out of alignment. Tokens are wrapped in spans; all
// whitespace is preserved verbatim.

/** Append a text node (escaped automatically by the DOM). */
function text(parent: Node, value: string): void {
	parent.appendChild(document.createTextNode(value));
}

/** Append a `<span class="yt-yl-...">` with raw text. */
function span(parent: HTMLElement, cls: string, value: string): void {
	const s = parent.createSpan({ cls: `yt-yl-${cls}` });
	text(s, value);
}

/** Classify a trimmed scalar and append the *raw* text (spaces intact) in a span. */
function appendValue(parent: HTMLElement, raw: string): void {
	if (raw === "") return;
	const t = raw.trim();
	let cls = "string";
	if (/^(true|false|yes|no|on|off)$/i.test(t)) cls = "bool";
	else if (/^(null|~)$/i.test(t)) cls = "null";
	else if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(t)) cls = "number";
	else if (/^".*"$/.test(t) || /^'.*'$/.test(t)) cls = "string";
	span(parent, cls, raw);
}

/** Split a value region into its scalar and an optional trailing `#` comment. */
function appendValueWithComment(parent: HTMLElement, after: string): void {
	if (after === "") return;
	if (/^["']/.test(after)) {
		const m = after.match(/^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*')(\s+#.*)?$/);
		if (m) {
			appendValue(parent, m[1]);
			if (m[2]) span(parent, "comment", m[2]);
			return;
		}
		appendValue(parent, after);
		return;
	}
	const ci = after.search(/\s#/);
	if (ci >= 0) {
		appendValue(parent, after.slice(0, ci));
		span(parent, "comment", after.slice(ci));
		return;
	}
	appendValue(parent, after);
}

function highlightLine(parent: HTMLElement, line: string): void {
	const indentMatch = /^\s*/.exec(line);
	const indent = indentMatch ? indentMatch[0] : "";
	let rest = line.slice(indent.length);
	if (indent) text(parent, indent);

	// Leading list-item dashes ("- ", or nested "- - ").
	let dashes = "";
	let m: RegExpMatchArray | null;
	while ((m = rest.match(/^(-\s+)/))) {
		dashes += m[1];
		rest = rest.slice(m[1].length);
	}
	if (rest === "-") {
		dashes += "-";
		rest = "";
	}
	if (dashes) span(parent, "dash", dashes);

	if (rest === "") return;
	if (rest.startsWith("#")) {
		span(parent, "comment", rest);
		return;
	}
	if (rest === "---" || rest === "...") {
		span(parent, "marker", rest);
		return;
	}

	// key: value — the key ends at the first colon followed by space or EOL.
	const km = rest.match(/^(.*?):(?=\s|$)/);
	if (km && !km[1].includes("#")) {
		const key = km[1];
		const after = rest.slice(km[0].length);
		const leadMatch = /^\s*/.exec(after);
		const lead = leadMatch ? leadMatch[0] : "";
		span(parent, "key", key);
		span(parent, "punc", ":");
		if (lead) text(parent, lead);
		appendValueWithComment(parent, after.slice(lead.length));
		return;
	}

	// A bare scalar (e.g. an item in a scalar list, or a plain document).
	appendValueWithComment(parent, rest);
}

/**
 * Highlight a whole YAML document into `parent`, replacing its children.
 * Newlines are emitted as text nodes so the `<pre>` lays out lines correctly.
 */
export function highlightYaml(parent: HTMLElement, textStr: string): void {
	parent.empty();
	const lines = textStr.split("\n");
	for (let i = 0; i < lines.length; i++) {
		if (i > 0) text(parent, "\n");
		highlightLine(parent, lines[i]);
	}
}
