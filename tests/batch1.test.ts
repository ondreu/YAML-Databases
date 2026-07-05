import { test } from "node:test";
import assert from "node:assert/strict";
import { countMatches, replaceAll } from "../src/model/find";
import { collectComponents } from "../src/model/dedupe";
import { flattenBom, flatRowsToRecords } from "../src/model/flatten";
import { columnTotals } from "../src/model/aggregate";

test("find: counts matches across nested sub-tables", () => {
	const root = [
		{ part: "M3 bolt", note: "steel", components: [{ part: "bolt head" }] },
		{ part: "M3 nut" },
	];
	assert.equal(countMatches(root, { query: "bolt" }), 2); // "M3 bolt" + "bolt head"
	assert.equal(countMatches(root, { query: "M3", column: "part" }), 2);
	assert.equal(countMatches(root, { query: "steel", wholeCell: true }), 1);
});

test("find: replaceAll updates substrings and whole cells", () => {
	const root = [{ part: "M3 bolt" }, { part: "M3 nut", sub: [{ part: "m3 washer" }] }];
	const n = replaceAll(root, { query: "M3", caseSensitive: false }, "M4");
	assert.equal(n, 3);
	assert.deepEqual(root, [
		{ part: "M4 bolt" },
		{ part: "M4 nut", sub: [{ part: "M4 washer" }] },
	]);
});

test("find: does not touch numbers (would change type)", () => {
	const root = [{ qty: 3, name: "3 pack" }];
	const n = replaceAll(root, { query: "3" }, "9");
	assert.equal(n, 1);
	assert.deepEqual(root, [{ qty: 3, name: "9 pack" }]);
});

test("dedupe: unique components with counts, most frequent first", () => {
	const root = [
		{ part: "bolt", qty: 1, sub: [{ part: "bolt", qty: 1 }] },
		{ part: "nut", qty: 2 },
	];
	const comps = collectComponents(root);
	const bolt = comps.find((c) => c.label === "bolt");
	assert.ok(bolt);
	assert.equal(bolt!.count, 2);
	assert.equal(comps[0].label, "bolt"); // most frequent first
	// template is scalar-only (no nested sub-table field).
	assert.deepEqual(bolt!.template, { part: "bolt", qty: 1 });
});

test("flatten: rolls up quantities through sub-assemblies", () => {
	const bom = [
		{
			part: "Assembly A",
			qty: 2,
			components: [
				{ part: "bolt", qty: 4 },
				{ part: "nut", qty: 4 },
			],
		},
		{ part: "bolt", qty: 3 },
	];
	const flat = flattenBom(bom);
	const byName = Object.fromEntries(flat.rows.map((r) => [r.name, r.quantity]));
	// bolt: 2*4 (in assembly) + 3 (top level) = 11
	assert.equal(byName["bolt"], 11);
	assert.equal(byName["nut"], 8); // 2*4
	assert.equal(byName["Assembly A"], 2);
	assert.equal(flat.nameKey, "part");
	assert.equal(flat.quantityKey, "qty");

	const records = flatRowsToRecords(flat);
	assert.ok(records.every((r) => "part" in r && "qty" in r));
});

test("aggregate: numeric columns get sum/avg; text columns just count", () => {
	const records = [
		{ part: "a", qty: 2 },
		{ part: "b", qty: 3 },
		{ part: "c", qty: null },
	];
	const totals = columnTotals(records, ["part", "qty"]);
	assert.equal(totals.part.numeric, false);
	assert.equal(totals.part.count, 3);
	assert.equal(totals.qty.numeric, true);
	assert.equal(totals.qty.sum, 5);
	assert.equal(totals.qty.avg, 2.5);
});
