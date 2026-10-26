import assert from "node:assert/strict";
import { applyImmutable, track } from "@earendil-works/chord/delta";
import { test } from "vitest";

test("preserves draft-sourced descendant edits without exposing tracker metadata", () => {
	const tracker = track({
		a: { child: { value: 1 } },
		b: null as { child: { value: number } } | null,
		rows: [{ child: { value: 1 } }, { child: { value: 2 } }],
	});
	let replica = structuredClone(tracker.value);
	const change = tracker.beginChange();
	change.state.a.child.value = 2;
	change.state.b = change.state.a;
	change.state.rows[1] = change.state.rows[0]!;
	change.state.rows[1]!.child.value = 3;
	const prepared = change.prepare();
	tracker.adopt(prepared);
	replica = applyImmutable(replica, prepared.ops);
	assert.deepEqual(tracker.value, {
		a: { child: { value: 2 } },
		b: { child: { value: 2 } },
		rows: [{ child: { value: 1 } }, { child: { value: 3 } }],
	});
	assert.deepEqual(replica, tracker.value);
	assert.notEqual(tracker.value.a, tracker.value.b);
	assert.notEqual(tracker.value.a.child, tracker.value.b?.child);
	assert.notEqual(tracker.value.rows[0], tracker.value.rows[1]);
	assert.notEqual(tracker.value.rows[0]!.child, tracker.value.rows[1]!.child);
});
