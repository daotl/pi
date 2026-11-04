import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const html = readFileSync(new URL("./ui.html", import.meta.url), "utf8");
const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const result = (suggestion = "none", category = "bugs") => ({ suggestion, category, confidence: "high", summary: "summary", signals: [], duplicates: [], reason: "reason" });
const issue = (number, status = "done", suggestion = "none", category = "bugs") => ({ number, title: `Issue ${number}`, author: "author", association: "NONE", status: "open", createdAt: "2026-01-01T00:00:00Z", body: "body", authorStats: { prior: 0 }, triage: { status, result: result(suggestion, category) }, decision: null });
const snapshot = (items) => ({ repo: "owner/repo", items, categories: [{ name: "bugs" }, { name: "features" }], queue: {}, sync: {}, inboxSince: "2026-01-01", model: "local", cost: 0 });

function harness() {
	const listeners = {}, requests = [], nodes = Object.fromEntries(["main", "cat", "status", "sync"].map((id) => [id, { innerHTML: "", value: "" }]));
	let poll, focusedSelect = null, focused = null, mainVersion = 0, mainHtml = "", selectedRange = null;
	const body = { tagName: "BODY", nodeType: 1 };
	Object.assign(nodes.main, { tagName: "MAIN", nodeType: 1, id: "main", parentNode: body, parentElement: body });
	Object.defineProperty(nodes.main, "innerHTML", {
		get: () => mainHtml,
		set: (value) => {
			// Replacing selected text nodes collapses a native range into their parent.
			if (selectedRange?.intersectsNode(nodes.main)) {
				selectedRange.startContainer = selectedRange.endContainer = nodes.main;
				selectedRange.startOffset = selectedRange.endOffset = 0;
				selectedRange.collapsed = true;
			}
			mainHtml = value; mainVersion++;
		},
	});
	nodes.main.contains = (node) => node === nodes.main || (!!node && node.mainVersion === mainVersion);
	const selection = {
		get rangeCount() { return selectedRange ? 1 : 0; },
		get isCollapsed() { return !selectedRange || selectedRange.collapsed; },
		get anchorNode() { return selectedRange?.startContainer ?? null; },
		get focusNode() { return selectedRange?.endContainer ?? null; },
		get anchorOffset() { return selectedRange?.startOffset ?? 0; },
		get focusOffset() { return selectedRange?.endOffset ?? 0; },
		getRangeAt(index) { assert.equal(index, 0); assert.ok(selectedRange); return selectedRange; },
		containsNode(node) { return selectedRange?.intersectsNode(node) ?? false; },
		toString() { return this.isCollapsed ? "" : selectedRange.text; },
	};
	const timers = [];
	const tabs = ["inbox", "decided", "all"].map((view) => ({ dataset: { view }, classList: { toggle() {} } }));
	const focusedElement = () => nodes.main.contains(focused) ? focused : null;
	const focusedQuery = (selector) => {
		const target = focusedElement();
		if (!target) return null;
		return selector.split(",").some((part) => {
			const query = part.trim();
			return query.endsWith(":focus") && target.matches(query.replace(/^#main\s+/, "").slice(0, -6));
		}) ? target : null;
	};
	nodes.main.querySelector = focusedQuery;
	const document = { hidden: false, get activeElement() { return focusedElement() ?? body; }, getSelection: () => selection, getElementById: (id) => nodes[id], addEventListener: (name, fn) => { listeners[name] = fn; }, querySelectorAll: (selector) => selector === ".tab" ? tabs : [], querySelector: focusedQuery };
	runInNewContext(script, { document, queueMicrotask, getSelection: () => selection, setTimeout: (fn) => timers.push(fn), window: { getSelection: () => selection, open() {}, addEventListener() {} }, confirm: () => true, setInterval: (fn) => { poll = fn; }, fetch: (path, options) => new Promise((resolve) => { requests.push({ path, body: options && JSON.parse(options.body), resolve }); }) });
	const respond = async (request, value) => { request.resolve({ ok: true, json: async () => value }); await tick(); };
	const key = (key, repeat = false) => listeners.keydown({ key, repeat, target: { tagName: "BODY" } });
	const click = (dataset) => listeners.click({ target: { closest: (selector) => selector === "[data-act]" ? { dataset } : null } });
	Object.assign(nodes.sync, { retry: () => nodes.sync.onclick() });
	const focusControl = (tagName, dataset = {}) => {
		const markup = [...mainHtml.matchAll(new RegExp(`<${tagName.toLowerCase()}\\b[^>]*>`, "g"))].find(([tag]) => Object.entries(dataset).every(([name, value]) => tag.includes(`data-${name}="${value}"`)))?.[0];
		assert.ok(markup, `Rendered ${tagName} control exists`);
		const control = {
			tagName, dataset, mainVersion, value: "bugs",
			get isConnected() { return nodes.main.contains(this); },
			matches: (selector) => selector.split(",").some((part) => {
				const tag = part.trim();
				return tag === "*" || tag === "" || tag.toUpperCase() === tagName || (tag === "a[href]" && tagName === "A");
			}),
			closest(selector) {
				if (selector === "#main") return this.isConnected ? nodes.main : null;
				if (selector === "[data-act]") return dataset.act ? this : null;
				return this.matches(selector) ? this : null;
			},
		};
		focused = control;
		return control;
	};
	const focusCategory = (number) => { focusedSelect = focusControl("SELECT", { act: "cat", n: String(number) }); };
	const blurFocus = async (next) => {
		const target = focused;
		focused = null;
		listeners.focusout?.({ target });
		if (next) next();
		await tick();
	};
	const tabFocus = async (next) => {
		const target = focused;
		focused = null;
		listeners.focusout?.({ target });
		await tick();
		if (next) next();
		await runTimers();
	};
	const blurCategory = blurFocus;
	const changeCategory = (value) => { focusedSelect.value = value; listeners.change({ target: focusedSelect }); };
	const pointer = (type, pointerId = 1) => listeners[type]?.({ pointerId });
	const runTimers = async () => { timers.splice(0).forEach((fn) => fn()); await tick(); };
	const finishPointer = async (type) => { if (type) pointer(type); await runTimers(); };
	const clickControl = (control) => {
		assert.equal(control.isConnected, true, "Native click must still have its mounted target");
		listeners.click({ target: control });
	};
	const selectText = (position = "inside") => {
		const textNode = (inside, text) => {
			const parent = inside ? nodes.main : body;
			return { nodeType: 3, nodeName: "#text", textContent: text, parentNode: parent, parentElement: parent, ...(inside ? { mainVersion } : {}), get isConnected() { return inside ? nodes.main.contains(this) : true; } };
		};
		const startInside = position === "inside" || position === "leaving";
		const endInside = position === "inside" || position === "entering";
		if (startInside || endInside) assert.match(mainHtml, /summary/);
		selectedRange = {
			startContainer: textNode(startInside, startInside ? "summary" : "outside before"),
			endContainer: textNode(endInside, endInside ? "body" : "outside after"),
			startOffset: 1, endOffset: 3, collapsed: false, text: "selected issue text",
			get commonAncestorContainer() { return position === "inside" ? nodes.main : body; },
			intersectsNode(node) { return !this.collapsed && position !== "outside" && (node === nodes.main || nodes.main.contains(node)); },
			toString() { return this.collapsed ? "" : this.text; },
		};
		listeners.selectionchange?.({ target: document });
		return selectedRange;
	};
	const collapseSelection = async () => {
		selectedRange.startContainer = selectedRange.endContainer;
		selectedRange.startOffset = selectedRange.endOffset;
		selectedRange.collapsed = true;
		listeners.selectionchange?.({ target: document });
		await tick();
	};
	// This models the event handoff only; a real browser must prove native Space activation.
	let spaceTarget = null;
	const spaceDown = () => {
		spaceTarget = document.activeElement;
		listeners.keydown({ key: " ", repeat: false, target: spaceTarget });
	};
	const spaceUp = () => {
		const target = document.activeElement;
		listeners.keyup?.({ key: " ", target });
		if (target === spaceTarget && target.isConnected) listeners.click({ target });
		spaceTarget = null;
	};
	return { nodes, requests, respond, key, click, clickControl, pointer, finishPointer, runTimers, focusCategory, blurCategory, changeCategory, focusControl, blurFocus, tabFocus, spaceDown, spaceUp, selectText, collapseSelection, selection, get mainVersion() { return mainVersion; }, get activeElement() { return document.activeElement; }, poll: () => poll(), tab: (view) => tabs.find((tab) => tab.dataset.view === view).onclick(), category: (value) => { nodes.cat.value = value; listeners.change({ target: { id: "cat", value, dataset: {} } }); } };
}

for (const view of ["inbox", "decided", "all"]) {
	test(`selecting ${view} before the initial state arrives preserves the chosen view`, async () => {
		const ui = harness();
		ui.tab(view);
		const decided = issue(10); decided.decision = { priority: "p0" };
		await ui.respond(ui.requests[0], snapshot([decided, issue(20)]));
		if (view === "inbox") assert.doesNotMatch(ui.nodes.main.innerHTML, /Issue 10/);
		else assert.match(ui.nodes.main.innerHTML, /Issue 10/);
		if (view === "decided") assert.doesNotMatch(ui.nodes.main.innerHTML, /Issue 20/);
		else assert.match(ui.nodes.main.innerHTML, /Issue 20/);
	});
}

for (const failure of ["http", "network"]) {
	test(`tabs remain usable after an initial ${failure} failure and Sync restores the selected view`, async () => {
		const ui = harness();
		ui.requests[0].resolve(failure === "http"
			? { ok: false, status: 503, text: async () => "unavailable" }
			: Promise.reject(new Error("offline")));
		await tick();
		ui.tab("inbox"); ui.tab("all"); ui.tab("decided");
		assert.match(ui.nodes.status.innerHTML, /State refresh failed/);
		ui.nodes.sync.retry();
		const decided = issue(10); decided.decision = { priority: "p0" };
		await ui.respond(ui.requests[1], snapshot([decided, issue(20)]));
		assert.match(ui.nodes.main.innerHTML, /Issue 10/);
		assert.doesNotMatch(ui.nodes.main.innerHTML, /Issue 20/);
		assert.doesNotMatch(ui.nodes.status.innerHTML, /State refresh failed/);
	});
}

test("a delayed poll preserves a category selection and installs its snapshot after blur", async () => {
	const ui = harness();
	await ui.respond(ui.requests[0], snapshot([issue(10)]));
	ui.poll();
	ui.focusCategory(10);
	await ui.respond(ui.requests[1], snapshot([issue(20)]));
	assert.match(ui.nodes.main.innerHTML, /Issue 10/);
	assert.doesNotMatch(ui.nodes.main.innerHTML, /Issue 20/);
	await ui.blurCategory();
	await ui.runTimers();
	assert.match(ui.nodes.main.innerHTML, /Issue 20/);
});

for (const action of ["prio", "retriage", "allnone"]) {
	for (const arrival of ["before Space", "during Space"]) {
		test(`a focused ${action} survives a poll ${arrival} and activates exactly once on keyup`, async () => {
			const ui = harness();
			await ui.respond(ui.requests[0], snapshot([issue(10)]));
			const control = ui.focusControl("BUTTON", action === "prio" ? { act: action, n: "10", p: "p0" } : action === "retriage" ? { act: action, n: "10" } : { act: action });
			ui.poll();
			assert.equal(ui.requests[1].path, "/api/state");
			if (arrival === "during Space") ui.spaceDown();
			await ui.respond(ui.requests[1], snapshot([issue(99)]));
			assert.equal(control.isConnected, true, "The poll must not detach the activation target");
			assert.equal(ui.activeElement, control, "The poll must retain keyboard focus");
			if (arrival === "before Space") ui.spaceDown();
			assert.equal(ui.requests.length, 2, "Space keydown must not submit an action");
			ui.spaceUp();
			ui.spaceUp();
			assert.equal(ui.requests.length, 3, "Exactly one action must be submitted");
			assert.equal(ui.requests[2].path, action === "retriage" ? "/api/retriage" : "/api/decide");
			assert.deepEqual(ui.requests[2].body, action === "allnone" ? { numbers: [10], priority: "none" } : action === "retriage" ? { number: 10 } : { number: 10, priority: "p0" });
			assert.doesNotMatch(ui.nodes.main.innerHTML, /Issue 99/);
			if (action !== "retriage") assert.match(ui.nodes.main.innerHTML, /data-act="prio" data-p="p0" data-n="10" disabled/);
		});
	}
}

for (const tagName of ["BUTTON", "SUMMARY", "A"]) {
	test(`a deferred poll waits for focus to leave a ${tagName} and settle outside main`, async () => {
		const ui = harness();
		await ui.respond(ui.requests[0], snapshot([issue(10)]));
		ui.poll();
		ui.focusControl(tagName);
		await ui.respond(ui.requests[1], snapshot([issue(99)]));
		assert.match(ui.nodes.main.innerHTML, /Issue 10/);
		await ui.blurFocus(() => ui.focusControl("SUMMARY"));
		await ui.runTimers();
		assert.match(ui.nodes.main.innerHTML, /Issue 10/, "Moving focus within main must retain the deferred snapshot");
		await ui.blurFocus();
		await ui.runTimers();
		assert.match(ui.nodes.main.innerHTML, /Issue 99/);
	});
}

test("a deferred poll preserves the original Tab destination across the focusout microtask checkpoint", async () => {
	const ui = harness();
	await ui.respond(ui.requests[0], snapshot([issue(10)]));
	const destination = ui.focusControl("BUTTON", { act: "prio", n: "10", p: "p1" });
	ui.focusControl("BUTTON", { act: "prio", n: "10", p: "p0" });
	ui.poll();
	await ui.respond(ui.requests[1], snapshot([issue(99)]));
	await ui.tabFocus(() => {
		assert.equal(destination.isConnected, true, "Native Tab must not lose its destination between focus events");
		ui.focusControl("BUTTON", { act: "prio", n: "10", p: "p1" });
	});
	assert.match(ui.nodes.main.innerHTML, /Issue 10/);
	await ui.blurFocus();
	await ui.runTimers();
	assert.match(ui.nodes.main.innerHTML, /Issue 99/);
});

test("a failed poll reports its error without replacing a keyboard-focused control", async () => {
	const ui = harness();
	await ui.respond(ui.requests[0], snapshot([issue(10)]));
	const control = ui.focusControl("BUTTON", { act: "retriage", n: "10" });
	ui.poll();
	ui.requests[1].resolve({ ok: false, status: 503, text: async () => "unavailable" });
	await tick();
	assert.match(ui.nodes.status.innerHTML, /State refresh failed/);
	assert.equal(control.isConnected, true);
	assert.equal(ui.activeElement, control);
});

for (const action of ["prio", "retriage", "allnone"]) {
	test(`a deferred select refresh preserves the pointer handoff to ${action}`, async () => {
		const ui = harness();
		await ui.respond(ui.requests[0], snapshot([issue(10)]));
		ui.poll();
		ui.focusCategory(10);
		await ui.respond(ui.requests[1], snapshot([issue(99)]));
		ui.pointer("pointerdown");
		await ui.blurCategory();
		assert.match(ui.nodes.main.innerHTML, /Issue 10/);
		assert.doesNotMatch(ui.nodes.main.innerHTML, /Issue 99/);
		ui.pointer("pointerup");
		await tick();
		assert.match(ui.nodes.main.innerHTML, /Issue 10/);
		ui.click({ act: action, n: "10", p: "p0" });
		await ui.finishPointer();
		assert.equal(ui.requests[2].path, action === "retriage" ? "/api/retriage" : "/api/decide");
		assert.deepEqual(ui.requests[2].body, action === "allnone" ? { numbers: [10], priority: "none" } : action === "retriage" ? { number: 10 } : { number: 10, priority: "p0" });
		assert.doesNotMatch(ui.nodes.main.innerHTML, /Issue 99/);
	});
}

for (const end of ["pointerup", "pointercancel"]) {
	test(`a ${end} without an action releases a deferred select refresh`, async () => {
		const ui = harness();
		await ui.respond(ui.requests[0], snapshot([issue(10)]));
		ui.poll();
		ui.focusCategory(10);
		await ui.respond(ui.requests[1], snapshot([issue(99)]));
		ui.pointer("pointerdown");
		await ui.blurCategory();
		assert.match(ui.nodes.main.innerHTML, /Issue 10/);
		await ui.finishPointer(end);
		assert.match(ui.nodes.main.innerHTML, /Issue 99/);
	});
}

test("changing a category invalidates a deferred poll before it can replace the decision refresh", async () => {
	const ui = harness();
	await ui.respond(ui.requests[0], snapshot([issue(10)]));
	ui.poll();
	ui.focusCategory(10);
	await ui.respond(ui.requests[1], snapshot([issue(99)]));
	ui.changeCategory("features");
	assert.deepEqual(ui.requests[2].body, { number: 10, category: "features" });
	await ui.blurCategory();
	assert.doesNotMatch(ui.nodes.main.innerHTML, /Issue 99/);
	await ui.respond(ui.requests[2]);
	const updated = issue(10); updated.decision = { category: "features" };
	await ui.respond(ui.requests[3], snapshot([updated]));
	assert.match(ui.nodes.main.innerHTML, /features ✎/);
	assert.doesNotMatch(ui.nodes.main.innerHTML, /Issue 99/);
});

test("only the newest deferred snapshot can install after focus leaves a select", async () => {
	const ui = harness();
	await ui.respond(ui.requests[0], snapshot([issue(10)]));
	ui.poll(); ui.poll();
	ui.focusCategory(10);
	await ui.respond(ui.requests[2], snapshot([issue(20)]));
	await ui.respond(ui.requests[1], snapshot([issue(30)]));
	await ui.blurCategory();
	await ui.runTimers();
	assert.match(ui.nodes.main.innerHTML, /Issue 20/);
	assert.doesNotMatch(ui.nodes.main.innerHTML, /Issue 30/);
});

for (const failure of ["http", "network"]) {
	test(`a failed ${failure} poll keeps category decisions authoritative over later stale refreshes`, async () => {
		const ui = harness();
		await ui.respond(ui.requests[0], snapshot([issue(10)]));
		ui.poll();
		ui.focusCategory(10);
		ui.requests[1].resolve(failure === "http"
			? { ok: false, status: 503, text: async () => "unavailable" }
			: Promise.reject(new Error("offline")));
		await tick();
		assert.match(ui.nodes.status.innerHTML, /State refresh failed/);
		ui.nodes.sync.retry();
		await ui.respond(ui.requests[2], snapshot([issue(99)]));
		ui.changeCategory("features");
		assert.deepEqual(ui.requests[3].body, { number: 10, category: "features" });
		await ui.blurCategory();
		await ui.respond(ui.requests[3]);
		const updated = issue(10); updated.decision = { category: "features" };
		await ui.respond(ui.requests[4], snapshot([updated]));
		assert.match(ui.nodes.main.innerHTML, /features ✎/);
		assert.doesNotMatch(ui.nodes.main.innerHTML, /Issue 99/);
		assert.doesNotMatch(ui.nodes.status.innerHTML, /State refresh failed/);
	});
}

for (const action of ["retriage", "sync"]) {
	test(`a category decision supersedes the deferred refresh of an unrelated ${action}`, async () => {
		const ui = harness();
		await ui.respond(ui.requests[0], snapshot([issue(10), issue(20)]));
		if (action === "sync") ui.nodes.sync.retry();
		else ui.click({ act: action, n: "20" });
		ui.focusCategory(10);
		await ui.respond(ui.requests[1]);
		await ui.respond(ui.requests[2], snapshot([issue(99)]));
		ui.changeCategory("features");
		assert.deepEqual(ui.requests[3].body, { number: 10, category: "features" });
		await ui.blurCategory();
		await ui.respond(ui.requests[3]);
		const updated = issue(10); updated.decision = { category: "features" };
		await ui.respond(ui.requests[4], snapshot([updated, issue(20)]));
		assert.match(ui.nodes.main.innerHTML, /features ✎/);
		assert.doesNotMatch(ui.nodes.main.innerHTML, /Issue 99/);
	});
}

test("bulk none decides only done suggestions in the displayed category", async () => {
	const ui = harness();
	await ui.respond(ui.requests[0], snapshot([issue(1), issue(2, "queued"), issue(3, "running"), issue(4, "failed"), issue(5, "done", "none", "features")]));
	ui.category("bugs");
	ui.click({ act: "allnone" });
	assert.deepEqual(ui.requests[1].body, { numbers: [1], priority: "none" });
});

test("selection follows identity through regrouping and clears after removal", async () => {
	const ui = harness();
	await ui.respond(ui.requests[0], snapshot([issue(10, "done", "p0"), issue(20, "done", "p1")]));
	ui.key("j");
	ui.poll();
	await ui.respond(ui.requests[1], snapshot([issue(30, "done", "p0"), issue(20, "done", "p1"), issue(10)]));
	assert.match(ui.nodes.main.innerHTML, /class="card sel" data-n="10"/);
	ui.key("0");
	assert.deepEqual(ui.requests[2].body, { number: 10, priority: "p0" });
	ui.key("1");
	ui.key("n", true);
	assert.equal(ui.requests.length, 3);
	await ui.respond(ui.requests[2]);
	const decided = issue(10); decided.decision = { priority: "p0" };
	await ui.respond(ui.requests[3], snapshot([issue(30), decided]));
	ui.key("0", true);
	ui.key("1");
	assert.equal(ui.requests.length, 4);
	assert.doesNotMatch(ui.nodes.main.innerHTML, /card sel/);
});

test("old polls cannot overwrite mutation refreshes or derive a stale priority toggle", async () => {
	const ui = harness();
	await ui.respond(ui.requests[0], snapshot([issue(10)]));
	ui.tab("all");
	ui.poll();
	const old = ui.requests[1];
	ui.click({ act: "prio", n: "10", p: "p0" });
	await ui.respond(ui.requests[2]);
	const decided = issue(10); decided.decision = { priority: "p0" };
	await ui.respond(ui.requests[3], snapshot([decided]));
	await ui.respond(old, snapshot([issue(10)]));
	assert.match(ui.nodes.main.innerHTML, /btn p0 on/);
	ui.click({ act: "prio", n: "10", p: "p0" });
	assert.deepEqual(ui.requests[4].body, { number: 10, priority: null });
});

test("mutation start invalidates polls even before its authoritative refresh", async () => {
	const ui = harness();
	await ui.respond(ui.requests[0], snapshot([issue(10)]));
	ui.poll();
	ui.click({ act: "retriage", n: "10" });
	await ui.respond(ui.requests[1], snapshot([issue(99)]));
	assert.match(ui.nodes.main.innerHTML, /Issue 10/);
	assert.doesNotMatch(ui.nodes.main.innerHTML, /Issue 99/);
	ui.poll();
	assert.equal(ui.requests.length, 3);
	await ui.respond(ui.requests[2]);
	const pending = issue(10, "queued"); pending.triage.result = null;
	await ui.respond(ui.requests[3], snapshot([pending]));
	assert.match(ui.nodes.main.innerHTML, /queued…/);
	ui.poll();
	const failed = issue(10, "failed"); failed.triage.result = null; failed.triage.error = "retry failed";
	await ui.respond(ui.requests[4], snapshot([failed]));
	assert.match(ui.nodes.main.innerHTML, /Triage failed: retry failed/);
});

test("only the newest overlapping state request installs its response", async () => {
	const ui = harness();
	await ui.respond(ui.requests[0], snapshot([issue(10)]));
	ui.poll(); ui.poll();
	await ui.respond(ui.requests[2], snapshot([issue(20)]));
	await ui.respond(ui.requests[1], snapshot([issue(30)]));
	assert.match(ui.nodes.main.innerHTML, /Issue 20/);
	assert.doesNotMatch(ui.nodes.main.innerHTML, /Issue 30/);
});

test("decision controls stay disabled until the authoritative refresh finishes", async () => {
	const ui = harness();
	await ui.respond(ui.requests[0], snapshot([issue(10), issue(20)]));
	ui.click({ act: "prio", n: "10", p: "p0" });
	ui.click({ act: "prio", n: "20", p: "p1" });
	ui.click({ act: "allnone" });
	assert.equal(ui.requests.length, 2);
	assert.match(ui.nodes.main.innerHTML, /data-act="prio" data-p="p0" data-n="20" disabled/);
	assert.match(ui.nodes.main.innerHTML, /data-act="cat" data-n="20" disabled/);
	assert.match(ui.nodes.main.innerHTML, /data-act="allnone" disabled/);
	await ui.respond(ui.requests[1]);
	assert.match(ui.nodes.main.innerHTML, /data-act="cat" data-n="20" disabled/);
	const decided = issue(10); decided.decision = { priority: "p0" };
	await ui.respond(ui.requests[2], snapshot([decided, issue(20)]));
	assert.doesNotMatch(ui.nodes.main.innerHTML, /data-n="20" disabled/);
	ui.click({ act: "prio", n: "20", p: "p1" });
	assert.deepEqual(ui.requests[3].body, { number: 20, priority: "p1" });
});

for (const order of ["decision-first", "other-first"]) {
	test(`overlapping ${order} mutations keep decisions gated until current state installs`, async () => {
		const ui = harness();
		await ui.respond(ui.requests[0], snapshot([issue(10)]));
		ui.tab("all");
		ui.click({ act: "prio", n: "10", p: "p0" });
		ui.click({ act: "retriage", n: "10" });
		await ui.respond(ui.requests[order === "decision-first" ? 1 : 2]);
		ui.click({ act: "prio", n: "10", p: "p0" });
		assert.equal(ui.requests.length, 3);
		assert.match(ui.nodes.main.innerHTML, /data-act="prio" data-p="p0" data-n="10" disabled/);
		await ui.respond(ui.requests[order === "decision-first" ? 2 : 1]);
		ui.click({ act: "prio", n: "10", p: "p0" });
		assert.equal(ui.requests.length, 4);
		const decided = issue(10); decided.decision = { priority: "p0" };
		await ui.respond(ui.requests[3], snapshot([decided]));
		ui.click({ act: "prio", n: "10", p: "p0" });
		assert.deepEqual(ui.requests[4].body, { number: 10, priority: null });
	});
}

for (const failure of ["http", "network"]) {
	test(`failed ${failure} decision refresh stays gated and Sync retries without mutating`, async () => {
		const ui = harness();
		await ui.respond(ui.requests[0], snapshot([issue(10)]));
		ui.tab("all");
		ui.click({ act: "prio", n: "10", p: "p0" });
		await ui.respond(ui.requests[1]);
		ui.requests[2].resolve(failure === "http" ? { ok: false, status: 503, text: async () => "unavailable" } : Promise.reject(new Error("offline")));
		await tick();
		assert.match(ui.nodes.status.innerHTML, /Sync to retry/);
		ui.click({ act: "prio", n: "10", p: "p0" });
		assert.equal(ui.requests.length, 3);
		ui.nodes.sync.retry();
		assert.equal(ui.requests[3].path, "/api/state");
		const decided = issue(10); decided.decision = { priority: "p0" };
		await ui.respond(ui.requests[3], snapshot([decided]));
		ui.click({ act: "prio", n: "10", p: "p0" });
		assert.deepEqual(ui.requests[4].body, { number: 10, priority: null });
	});
}

for (const action of ["prio", "allnone", "retriage", "sync"]) {
	for (const failure of ["http", "network"]) {
		test(`${action} ${failure} failures survive successful authoritative refreshes`, async () => {
			const ui = harness();
			await ui.respond(ui.requests[0], snapshot([issue(10), issue(20)]));
			if (action === "sync") ui.nodes.sync.retry();
			else ui.click({ act: action, n: "10", p: "p0" });
			ui.requests[1].resolve(failure === "http"
				? { ok: false, status: 500, text: async () => "disk full <details>" }
				: Promise.reject(new Error("network offline")));
			await tick();
			assert.equal(ui.requests[2].path, "/api/state");
			const partial = issue(10); partial.decision = { priority: "none" };
			await ui.respond(ui.requests[2], snapshot([partial, issue(20)]));
			assert.match(ui.nodes.status.innerHTML, /Operation failed:/);
			assert.match(ui.nodes.status.innerHTML, failure === "http" ? /500: disk full &lt;details&gt;/ : /network offline/);
			assert.doesNotMatch(ui.nodes.main.innerHTML, /data-n="20" disabled/);
			assert.doesNotMatch(ui.nodes.main.innerHTML, /Issue 10/);
			ui.poll();
			await ui.respond(ui.requests[3], snapshot([partial, issue(20)]));
			assert.match(ui.nodes.status.innerHTML, /Operation failed:/);
		});
	}
}

test("mutation and refresh errors are independent and a successful retry clears only the mutation error", async () => {
	const ui = harness();
	await ui.respond(ui.requests[0], snapshot([issue(10)]));
	ui.click({ act: "prio", n: "10", p: "p0" });
	ui.requests[1].resolve({ ok: false, status: 500, text: async () => "disk full" });
	await tick();
	ui.requests[2].resolve({ ok: false, status: 503, text: async () => "refresh unavailable" });
	await tick();
	assert.match(ui.nodes.status.innerHTML, /Operation failed:.*disk full/);
	assert.match(ui.nodes.status.innerHTML, /State refresh failed/);
	ui.nodes.sync.retry();
	await ui.respond(ui.requests[3], snapshot([issue(10)]));
	assert.match(ui.nodes.status.innerHTML, /Operation failed:.*disk full/);
	assert.doesNotMatch(ui.nodes.status.innerHTML, /State refresh failed/);
	ui.click({ act: "prio", n: "10", p: "p0" });
	await ui.respond(ui.requests[4]);
	const decided = issue(10); decided.decision = { priority: "p0" };
	await ui.respond(ui.requests[5], snapshot([decided]));
	assert.doesNotMatch(ui.nodes.status.innerHTML, /Operation failed/);
});

test("an overlapping successful mutation cannot erase another operation's failure", async () => {
	const ui = harness();
	await ui.respond(ui.requests[0], snapshot([issue(10)]));
	ui.click({ act: "prio", n: "10", p: "p0" });
	ui.click({ act: "retriage", n: "10" });
	ui.requests[1].resolve({ ok: false, status: 500, text: async () => "disk full" });
	await tick();
	await ui.respond(ui.requests[2]);
	await ui.respond(ui.requests[3], snapshot([issue(10)]));
	assert.match(ui.nodes.status.innerHTML, /Operation failed:.*disk full/);
});

for (const action of ["prio", "allnone"]) {
	for (const focus of ["button focus", "select-to-button focus handoff"]) {
		for (const completion of ["POST and state before release timer", "POST before and state after release timer", "POST and state after release timer"]) {
			test(`a pointer ${action} with ${focus} completes ${completion} and permits subsequent decisions`, async () => {
				const ui = harness();
				await ui.respond(ui.requests[0], snapshot([issue(10)]));
				if (focus === "select-to-button focus handoff") {
					ui.poll();
					ui.focusCategory(10);
					await ui.respond(ui.requests[1], snapshot([issue(99)]));
				}
				ui.pointer("pointerdown");
				let control;
				const focusButton = () => { control = ui.focusControl("BUTTON", action === "prio" ? { act: action, n: "10", p: "p0" } : { act: action }); };
				if (focus === "select-to-button focus handoff") await ui.blurCategory(focusButton);
				else focusButton();
				ui.pointer("pointerup");
				await tick();
				assert.equal(ui.activeElement, control, "Pointer activation leaves its button focused");
				const mutationIndex = ui.requests.length;
				ui.clickControl(control);
				assert.equal(ui.requests.length, mutationIndex + 1);
				assert.equal(ui.requests[mutationIndex].path, "/api/decide");
				assert.deepEqual(ui.requests[mutationIndex].body, action === "prio" ? { number: 10, priority: "p0" } : { numbers: [10], priority: "none" });
				assert.equal(control.isConnected, true, "The click target stays mounted through the pointer handoff");
				const decided = issue(10); decided.decision = { priority: action === "prio" ? "p0" : "none" };
				if (completion === "POST and state after release timer") {
					await ui.finishPointer();
					assert.match(ui.nodes.main.innerHTML, /data-act="prio" data-p="p0" data-n="10" disabled/, "Pending decisions must render disabled after the handoff even while the button had focus");
				}
				await ui.respond(ui.requests[mutationIndex]);
				assert.equal(ui.requests[mutationIndex + 1].path, "/api/state");
				if (completion === "POST before and state after release timer") {
					await ui.finishPointer();
					assert.match(ui.nodes.main.innerHTML, /data-act="prio" data-p="p0" data-n="10" disabled/);
				}
				await ui.respond(ui.requests[mutationIndex + 1], snapshot([decided, issue(20)]));
				if (completion === "POST and state before release timer") {
					assert.equal(control.isConnected, true, "An early authoritative response must still wait for the pointer handoff");
					await ui.finishPointer();
				}
				assert.match(ui.nodes.main.innerHTML, /Issue 20/, "Authoritative decision state must install without clicking outside main");
				assert.doesNotMatch(ui.nodes.main.innerHTML, /Issue 10|Issue 99|data-n="20" disabled/);
				for (const number of [20, 30]) {
					ui.pointer("pointerdown");
					const next = ui.focusControl("BUTTON", { act: "prio", n: String(number), p: "p1" });
					ui.pointer("pointerup");
					const nextIndex = ui.requests.length;
					ui.clickControl(next);
					assert.equal(ui.requests.length, nextIndex + 1, "Each later focused pointer decision must submit");
					assert.deepEqual(ui.requests[nextIndex].body, { number, priority: "p1" });
					await ui.finishPointer();
					await ui.respond(ui.requests[nextIndex]);
					assert.equal(ui.requests[nextIndex + 1].path, "/api/state");
					const updated = issue(number); updated.decision = { priority: "p1" };
					await ui.respond(ui.requests[nextIndex + 1], snapshot([updated, issue(number + 10)]));
					assert.match(ui.nodes.main.innerHTML, new RegExp(`Issue ${number + 10}`));
					assert.doesNotMatch(ui.nodes.main.innerHTML, new RegExp(`data-n="${number + 10}" disabled`));
				}
			});
		}
	}
}

test("a decision refresh preserves another issue's held Space retriage activation", async () => {
	const ui = harness();
	await ui.respond(ui.requests[0], snapshot([issue(10), issue(20)]));
	ui.click({ act: "prio", n: "10", p: "p0" });
	await ui.respond(ui.requests[1]);
	const target = ui.focusControl("BUTTON", { act: "retriage", n: "20" });
	ui.spaceDown();
	const decided = issue(10); decided.decision = { priority: "p0" };
	await ui.respond(ui.requests[2], snapshot([decided, issue(20)]));
	assert.equal(target.isConnected, true, "Authoritative decision refresh must retain native keyboard activation");
	assert.equal(ui.activeElement, target);
	ui.spaceUp();
	assert.equal(ui.requests[3].path, "/api/retriage");
	assert.deepEqual(ui.requests[3].body, { number: 20 });
	await ui.runTimers();
	await ui.respond(ui.requests[3]);
	await ui.respond(ui.requests[4], snapshot([decided, issue(20)]));
	assert.doesNotMatch(ui.nodes.main.innerHTML, /Issue 10|data-n="20" disabled/);
});

for (const arrival of ["during drag", "after drag"]) {
	for (const position of ["inside", "entering", "leaving"]) {
		for (const release of ["collapse", "outside selection"]) {
			test(`a poll ${arrival} preserves a noncollapsed ${position} main selection until ${release}`, async () => {
				const ui = harness();
				await ui.respond(ui.requests[0], snapshot([issue(10)]));
				ui.pointer("pointerdown");
				const range = ui.selectText(position);
				const start = range.startContainer, end = range.endContainer;
				const version = ui.mainVersion, markup = ui.nodes.main.innerHTML;
				if (arrival === "after drag") await ui.finishPointer("pointerup");
				ui.poll();
				assert.equal(ui.requests[1].path, "/api/state");
				await ui.respond(ui.requests[1], snapshot([issue(20)]));
				assert.equal(ui.mainVersion, version, "Polling must not replace DOM intersected by the selection");
				if (arrival === "during drag") await ui.finishPointer("pointerup");
				assert.equal(ui.mainVersion, version, "Pointer release must not end text-selection protection");
				assert.equal(ui.nodes.main.innerHTML, markup);
				assert.equal(ui.selection.getRangeAt(0), range);
				assert.equal(range.startContainer, start);
				assert.equal(range.endContainer, end);
				assert.equal(range.startOffset, 1);
				assert.equal(range.endOffset, 3);
				assert.equal(start.isConnected, true);
				assert.equal(end.isConnected, true);
				assert.equal(ui.selection.isCollapsed, false);
				assert.equal(ui.selection.toString(), "selected issue text", "Copyable selected text must survive the poll and drag end");
				ui.poll();
				await ui.respond(ui.requests[2], snapshot([issue(30)]));
				assert.equal(ui.mainVersion, version, "Later polls remain deferred while the range intersects main");
				if (release === "collapse") await ui.collapseSelection();
				else { ui.selectText("outside"); await tick(); }
				assert.match(ui.nodes.main.innerHTML, /Issue 30/, "selectionchange must flush the latest deferred snapshot");
				assert.doesNotMatch(ui.nodes.main.innerHTML, /Issue 10|Issue 20/);
			});
		}
	}
}

test("a noncollapsed selection outside main does not defer a poll", async () => {
	const ui = harness();
	await ui.respond(ui.requests[0], snapshot([issue(10)]));
	const range = ui.selectText("outside");
	ui.poll();
	await ui.respond(ui.requests[1], snapshot([issue(20)]));
	assert.match(ui.nodes.main.innerHTML, /Issue 20/);
	assert.equal(ui.selection.getRangeAt(0), range);
	assert.equal(ui.selection.isCollapsed, false);
	assert.equal(ui.selection.toString(), "selected issue text");
});
