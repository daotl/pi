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
	let poll;
	const tabs = ["inbox", "decided", "all"].map((view) => ({ dataset: { view }, classList: { toggle() {} } }));
	const document = { hidden: false, getElementById: (id) => nodes[id], addEventListener: (name, fn) => { listeners[name] = fn; }, querySelectorAll: (selector) => selector === ".tab" ? tabs : [], querySelector: () => null };
	runInNewContext(script, { document, window: { open() {} }, confirm: () => true, setInterval: (fn) => { poll = fn; }, fetch: (path, options) => new Promise((resolve) => { requests.push({ path, body: options && JSON.parse(options.body), resolve }); }) });
	const respond = async (request, value) => { request.resolve({ ok: true, json: async () => value }); await tick(); };
	const key = (key, repeat = false) => listeners.keydown({ key, repeat, target: { tagName: "BODY" } });
	const click = (dataset) => listeners.click({ target: { closest: (selector) => selector === "[data-act]" ? { dataset } : null } });
	Object.assign(nodes.sync, { retry: () => nodes.sync.onclick() });
	return { nodes, requests, respond, key, click, poll: () => poll(), tab: (view) => tabs.find((tab) => tab.dataset.view === view).onclick(), category: (value) => { nodes.cat.value = value; listeners.change({ target: { id: "cat", value, dataset: {} } }); } };
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
