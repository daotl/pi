import { describe, expect, it } from "vitest";
import { CodemodeSourceError, parseCodemodeSource } from "../src/source.ts";

describe("parseCodemodeSource", () => {
	it("returns plain code unchanged", () => {
		expect(parseCodemodeSource("text('hi')")).toEqual({ code: "text('hi')", options: {} });
		expect(parseCodemodeSource("// just a comment\nreturn 1")).toEqual({
			code: "// just a comment\nreturn 1",
			options: {},
		});
	});

	it("parses the options line and keeps line numbers", () => {
		expect(parseCodemodeSource('// @options: {"timeout_ms": 10}\nconst a = 1;\ntext(a)')).toEqual({
			code: "\nconst a = 1;\ntext(a)",
			options: { timeoutMs: 10 },
		});
		expect(parseCodemodeSource('  // @options:{"max_output_tokens":0,"timeout_ms":1500}\r\ntext(1)').options).toEqual(
			{
				maxOutputTokens: 0,
				timeoutMs: 1500,
			},
		);
		expect(parseCodemodeSource("// @options: {}\ntext(1)")).toEqual({ code: "\ntext(1)", options: {} });
	});

	it("only treats the first line as an options line", () => {
		expect(parseCodemodeSource("// @optionsx {}\ntext(1)").options).toEqual({});
		expect(parseCodemodeSource('text("// @options: {}")').options).toEqual({});
	});

	it("keeps options-looking text inside literals and block comments", () => {
		const inputs = [
			'const source = `example\n// @options: {"timeout_ms": 1000}\n`; return source;',
			'const source = "example\\\n// @options: {}"; return source;',
			"/* example\n// @options: {}\n*/ return 1;",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: source text intentionally contains template expressions.
			"const source = `outer ${`inner\n// @options: {}\n`} end`; return source;",
			'const pattern = /[`"]/; const source = `example\n// @options: {}\n`; return source;',
			// biome-ignore lint/suspicious/noTemplateCurlyInString: source text intentionally contains template expressions.
			"const source = `value ${({ a: 1 }).a}\n// @options: {}\n`; return source;",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: source text intentionally contains template expressions.
			"const source = `value ${(() => { return { a: 1 }; })().a}\n// @options: {}\n`; return source;",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: source text intentionally contains template expressions.
			"const source = `outer ${`inner ${({ a: 1 }).a}\n// @options: {}\n`} end`; return source;",
			"const pattern = /\\/\\/ @options: {}/; return pattern;",
		];
		for (const input of inputs) expect(parseCodemodeSource(input)).toEqual({ code: input, options: {} });
	});

	it("rejects actual options comments inside template expressions", () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: testing a comment inside a template expression.
		expect(() => parseCodemodeSource("const source = `value ${\n// @options: {}\n1}`")).toThrow(
			"found one on line 2",
		);
		// biome-ignore lint/suspicious/noTemplateCurlyInString: testing a comment inside a nested expression.
		expect(() => parseCodemodeSource("const source = `value ${({ a: 1 }).a + (\n// @options: {}\n1)}`")).toThrow(
			"found one on line 2",
		);
	});

	it("recognizes Unicode and escaped identifiers before division", () => {
		for (const identifier of ["数", "π", "𐐀", "á", "a‌", "a‍", "\\u6570", "\\u{10400}", "a\\u0301"]) {
			const prefix = `const ${identifier} = 4; const ratio = ${identifier} / 2;`;
			expect(() => parseCodemodeSource(`${prefix}\n// @options: {"timeout_ms": 1}\nwhile (true) {}`)).toThrow(
				"found one on line 2",
			);
			const literal = `const ${identifier} = 4; const ratio = ${identifier} / \`example\n// @options: {}\n\`;`;
			expect(parseCodemodeSource(literal)).toEqual({ code: literal, options: {} });
		}
	});

	it("rejects misplaced deadlines after postfix division and control-statement regexps", () => {
		for (const prefix of [
			"let n = 4; const ratio = n++ / 2;",
			"let n = 4; const ratio = n-- / 2;",
			"const obj = { if: () => 4 }; obj.if() / 2;",
			"const obj = { while: () => 4 }; obj?.while() / 2;",
			"const obj = { for: () => 4 }; obj['for']() / 2;",
			"const obj = { if() { return 4; } }; obj.if() / 2;",
			"const obj = { if: function() { return 4; } }; obj.if() / 2;",
			"again: { break again; } const ratio = 4 / 2;",
			"if (true) /`/.test('x');",
			"while (false) /`/.test('x');",
			"for (; false;) /`/.test('x');",
		]) {
			expect(() => parseCodemodeSource(`${prefix}\n// @options: {"timeout_ms": 1}\nreturn 1;`)).toThrow(
				"found one on line 2",
			);
			const literal = `${prefix}\nconst source = \`example\n// @options: {}\n\`; return source;`;
			expect(parseCodemodeSource(literal)).toEqual({ code: literal, options: {} });
		}
	});

	it("preserves for-await control parentheses across whitespace and comments", () => {
		for (const header of [
			"for await (const x of [])",
			"for /* loop */ await /* values */ (const x of [])",
			"for\nawait\n(const x of [])",
			"for // loop\nawait // values\n(const x of [])",
		]) {
			const prefix = `${header} /\`/.test('x');`;
			expect(() => parseCodemodeSource(`${prefix}\n// @options: {"timeout_ms": 1}\nwhile (true) {}`)).toThrow(
				`found one on line ${prefix.split("\n").length + 1}`,
			);
			const literal = `${prefix}\nconst source = \`example\n// @options: {}\n\`; return source;`;
			expect(parseCodemodeSource(literal)).toEqual({ code: literal, options: {} });
		}
		// A member named `for` must not make a later await expression a control header.
		const expression = "obj.for; await (value) / `example\n// @options: {}\n`;";
		expect(parseCodemodeSource(expression)).toEqual({ code: expression, options: {} });
	});

	it("rejects misplaced deadlines after statement-block and statement-keyword regexps", () => {
		for (const prefix of [
			"if (true) {} /`/.test('x');",
			"if (false) {} else {} /`/.test('x');",
			"try {} catch (error) {} /`/.test('x');",
			"try {} finally {} /`/.test('x');",
			"try {} catch {} /`/.test('x');",
			"function declared() {} /`/.test('x');",
			"async function declared() {} /`/.test('x');",
			"function* declared() {} /`/.test('x');",
			"{ function declared() {} /`/.test('x'); }",
			"label: {} /`/.test('x');",
			"if (true) { const value = {}; } /`/.test('x');",
			"if (false) {} else /`/.test('x');",
			"do /`/.test('x'); while (false);",
			"do {} while (false); /`/.test('x');",
		]) {
			const input = `${prefix}\n// @options: {"timeout_ms": 1}\nwhile (true) {}`;
			expect(() => parseCodemodeSource(input), prefix).toThrow(CodemodeSourceError);
			expect(() => parseCodemodeSource(input), prefix).toThrow("found one on line 2");
			const literal = `${prefix}\nconst source = \`example\n// @options: {}\n\`; return source;`;
			expect(parseCodemodeSource(literal), prefix).toEqual({ code: literal, options: {} });
		}
	});

	it("recognizes statement blocks after switch case and default labels", () => {
		for (const prefix of [
			"switch (1) { case 1: {} /`/.test('x'); }",
			"switch (1) { default: {} /`/.test('x'); }",
			"switch (1) { case true ? 1 : 2: {} /`/.test('x'); }",
			"switch (1) { case ({ value: 1 }).value: {} /`/.test('x'); }",
			"switch (1) { case 0: break; case 1: {} /`/.test('x'); }",
			"switch (1) { case 1: switch (2) { default: {} /`/.test('x'); } {} /`/.test('x'); }",
			"switch (1) { case (() => { switch (2) { default: break; } return 1; })(): {} /`/.test('x'); }",
		]) {
			expect(
				() => parseCodemodeSource(`${prefix}\n// @options: {"timeout_ms": 1}\nwhile (true) {}`),
				prefix,
			).toThrow("found one on line 2");
		}
		for (const label of ["case 1:", "default:", "case true ? 1 : 2:", "case ({ value: 1 }).value:"]) {
			const input = `switch (1) { ${label} {} \`example\n// @options: {}\n\`; }`;
			expect(parseCodemodeSource(input), label).toEqual({ code: input, options: {} });
		}
	});

	it("keeps object and conditional colons inside switch case expressions", () => {
		for (const expression of [
			"true ? 1 : {} /",
			"false ? 1 : true ? 2 : {} /",
			"true ?.5 : {} /",
			"({ value: {} /",
		]) {
			const suffix = expression.startsWith("(") ? " }).value" : "";
			const input = `switch (1) { case ${expression} \`example\n// @options: {}\n\`${suffix}: break; }`;
			expect(parseCodemodeSource(input), expression).toEqual({ code: input, options: {} });
		}
		for (const expression of [
			"value ?? 1",
			"value?.key",
			"value.case",
			"value.default",
			"({ case: 1, default: 2 }).case",
			"true ? { value: 1 } : { value: 2 }",
		]) {
			const prefix = `switch (1) { case ${expression}: {} /\`/.test('x'); }`;
			expect(() => parseCodemodeSource(`${prefix}\n// @options: {}\nreturn 1;`), expression).toThrow(
				"found one on line 2",
			);
		}
	});

	it("recognizes regexps after class declarations without breaking class-expression division", () => {
		for (const prefix of [
			"class A {} /`/.test('x');",
			"class A extends Object {} /`/.test('x');",
			"class A extends (class {}) {} /`/.test('x');",
			"class A { method() { return {}; } } /`/.test('x');",
			"export default class {} /`/.test('x');",
		]) {
			expect(
				() => parseCodemodeSource(`${prefix}\n// @options: {"timeout_ms": 1}\nwhile (true) {}`),
				prefix,
			).toThrow("found one on line 2");
			const literal = `${prefix}\nconst source = \`example\n// @options: {}\n\`;`;
			expect(parseCodemodeSource(literal), prefix).toEqual({ code: literal, options: {} });
		}
		for (const prefix of ["const A = class {}", "const A = class Named extends Object {}", "const A = (class {})"]) {
			const literal = `${prefix} / \`example\n// @options: {}\n\`;`;
			expect(parseCodemodeSource(literal), prefix).toEqual({ code: literal, options: {} });
		}
	});

	it("distinguishes object property names from class expressions", () => {
		for (const properties of [
			"class: 1,",
			"class() {},",
			"get class() { return 1; },",
			"async class() {},",
			"*class() {},",
			"function() {}, class: 1,",
			"value: class { class() {} }, class: 1,",
			"value: class extends (class {}) {},",
		]) {
			const prefix = `const o = { ${properties} m() { if (true) {} /\`/.test('x'); } };`;
			expect(() => parseCodemodeSource(`${prefix}\n// @options: {"timeout_ms": 1}\nwhile (true) {}`)).toThrow(
				"found one on line 2",
			);
			const literal = `${prefix}\nconst source = \`example\n// @options: {}\n\`;`;
			expect(parseCodemodeSource(literal)).toEqual({ code: literal, options: {} });
		}
		const division = "const o = { value: class {} / `example\n// @options: {}\n` };";
		expect(parseCodemodeSource(division)).toEqual({ code: division, options: {} });
	});

	it("does not treat class member names as declaration keywords", () => {
		for (const declaration of [
			"class A { class = {} / 2; }",
			"class A { class() { return {}; } }",
			"class A { function = {} / 2; }",
			"class A { static class = {} / 2; }",
			"class A { method() { const B = class {}; } class = {} / 2; }",
			"class A { x; class /* field */ = {} / 2; }",
			"class A { x; function /* field */ = {} / 2; }",
			"class A { x; class // field\n = {} / 2; }",
			"class A { x; class\nother = {} / 2; }",
			"class A { class\nfunction\nother = {} / 2; }",
			"class A { field = class {}; class\nother = {} / 2; }",
			"class A { #class = {} / 2; #function() { return {}; } }",
			"class A { static function() {} static class() {} }",
			"class A { async class() {} async function() {} }",
			"class A { get class() { return {}; } set function(value) {} }",
			"class A { *class() {} async *function() {} }",
			"class A { static #class() {} get #function() { return {}; } }",
			"class A { class /* field\n */ other = {} / 2; }",
			"class A { class // field\n function\n other = {} / 2; }",
			"class A { class\n = {} / 2; function\n = {} / 2; }",
			"class A { field = 1\n class\n other = {} / 2; }",
			"class A { field = {}\n function\n other = {} / 2; }",
			"class A { field = 1 /* field\n */ class\n other = {} / 2; }",
			"class A { field = 1 // field\n function\n other = {} / 2; }",
			"class A { field = 1\r\n class\r\n other = {} / 2; }",
			"class A { field = 1 /* field\u2028 */ class\n other = {} / 2; }",
			"class A { field = 1 /* field\u2029 */ function\n other = {} / 2; }",
			"class A { field = left\n / right; class = {} / 2; }",
			"class A { field = left\n / right\n class\n other = {} / 2; }",
			"class A { field =\n class Named {}; class = {} / 2; }",
			"class A { field = class Named\n {}; function = {} / 2; }",
			"class A { field = class extends Object\n {}; class = {} / 2; }",
			"class A { field = class extends (class {}) {}; class = {} / 2; }",
			"class A { field = class {};\n class\n other = {} / 2; }",
			"class A { field = class {}\n class\n other = {} / 2; }",
			"class A { field = true ?\n class {} :\n class Named {}; class = {} / 2; }",
			"class A { field = function() {}; class = {} / 2; }",
			"class A { field = function named() {}\n function\n other = {} / 2; }",
			"class A { field = class { class() {} function = class {}; }\n class\n other = {} / 2; }",
			"class A { field = function() { return class { class() {} }; }\n class\n other = {} / 2; }",
			"class A { field = class extends class {} {}\n function\n other = {} / 2; }",
			"class A { class(value = class {}) {} function\n other = {} / 2; }",
			"class A { static class\n static function\n other = {} / 2; }",
			"class A { field = 1\n #class\n #function = {} / 2; }",
			"class A { field = function\n named() {}; class = {} / 2; }",
			"class A { field = async function() {}; function = {} / 2; }",
			"class A { field = (() => {})\n class\n other = {} / 2; }",
			"class A { field = {} / 2\n class\n other = {} / 2; }",
			"class A { method() { const B = class {}; } class = class {}; function = {} / 2; }",
			"class A { static { const B = class {}; } function = function() {}; class = {} / 2; }",
			"class A { static { const B = class {}; } class\n other = {} / 2; }",
			"class A { method() { function declared() {} } function\n other = {} / 2; }",
			"class A { ['class']() {} class\n other = {} / 2; }",
		]) {
			expect(
				() => parseCodemodeSource(`${declaration}\n// @options: {"timeout_ms": 1}\nwhile (true) {}`),
				declaration,
			).toThrow(`found one on line ${declaration.split("\n").length + 1}`);
			const prefix = `${declaration} /\`/.test('x');`;
			expect(
				() => parseCodemodeSource(`${prefix}\n// @options: {"timeout_ms": 1}\nwhile (true) {}`),
				declaration,
			).toThrow(`found one on line ${declaration.split("\n").length + 1}`);
			const literal = `${prefix}\nconst source = \`example\n// @options: {}\n\`;`;
			expect(parseCodemodeSource(literal), declaration).toEqual({ code: literal, options: {} });
		}
	});

	it("keeps initializer division and multiline continuations inside class fields", () => {
		for (const expression of [
			"{}",
			"class {}",
			"class Named {}",
			"class extends (class {}) {}",
			"class { class() {} }",
			"class extends class {} {}",
			"function() {}",
			"function named() {}",
			"async function() {}",
			"(() => {})",
			"function*() {}",
			"async function*() {}",
			"async () => {}",
			"(() => ({ value: class {} }))",
		]) {
			// The slash must remain division after an initializer body, not start a regexp.
			const input = `class A { field = ${expression}\n / \`example\n// @options: {}\n\`; }`;
			expect(parseCodemodeSource(input), expression).toEqual({ code: input, options: {} });
		}
		for (const continuation of [
			"left\n / right",
			"left\n in right",
			"left\n instanceof Right",
			"value\n .class",
			"value\n .function()",
			"value\n [key]",
			"value\n (argument)",
			"value\n `tagged`",
			"value.\n class",
			"value.\n function()",
			"(class {})\n / other",
			"[class {}, function() {}]",
			"({ value: class {} })",
			"value\n + other",
			"value\n ? class {} : function() {}",
		]) {
			const declaration = `class A { field = ${continuation}\n class\n other = {} / 2; }`;
			const prefix = `${declaration} /\`/.test('x');`;
			expect(() => parseCodemodeSource(`${prefix}\n// @options: {}\nreturn 1;`), continuation).toThrow(
				`found one on line ${declaration.split("\n").length + 1}`,
			);
			const literal = `${prefix}\nconst source = \`example\n// @options: {}\n\`;`;
			expect(parseCodemodeSource(literal), continuation).toEqual({ code: literal, options: {} });
		}
	});

	it("keeps division after object, function-expression, and arrow-expression braces", () => {
		for (const expression of [
			"const value = {}",
			"const value = { nested: {} }",
			"const value = function() {}",
			"const value = function named() {}",
			"const value = async function() {}",
			"const value = true ? {} : function() {}",
			"const value = false ? function() {} : (() => {})",
			"const value = function*() {}",
			"const value = (() => {})",
			"const value = (async () => {})",
			"const value = (() => ({}))",
			"const value = (function() {})",
		]) {
			const input = `${expression} / 2;\n// @options: {"timeout_ms": 1}\nwhile (true) {}`;
			expect(() => parseCodemodeSource(input), expression).toThrow(CodemodeSourceError);
			expect(() => parseCodemodeSource(input), expression).toThrow("found one on line 2");
			const literal = `${expression} / \`example\n// @options: {}\n\`; return value;`;
			expect(parseCodemodeSource(literal), expression).toEqual({ code: literal, options: {} });
		}
	});

	it("finds deadlines after block-following regexps inside template interpolations", () => {
		const input =
			// biome-ignore lint/suspicious/noTemplateCurlyInString: testing JavaScript inside a template expression.
			"const source = `value ${(() => { if (true) {} /`/.test('x');\n// @options: {\"timeout_ms\": 1}\nreturn 1; })()}`";
		expect(() => parseCodemodeSource(input)).toThrow(CodemodeSourceError);
		expect(() => parseCodemodeSource(input)).toThrow("found one on line 2");
	});

	it("recognizes declaration bodies after automatic semicolon insertion", () => {
		for (const initializer of ["1", "{}", "function() {}", "class {}", "(() => {})"]) {
			for (const declaration of [
				"function f() {}",
				"async function f() {}",
				"class A {}",
				"class A extends Object {}",
			]) {
				for (const pattern of ["/`/", "/'/", '/"/']) {
					const prefix = `const n = ${initializer}\n${declaration}\n${pattern}.test("x");`;
					expect(() => parseCodemodeSource(`${prefix}\n// @options: {"timeout_ms": 1}\nwhile (true) {}`)).toThrow(
						"found one on line 4",
					);
					const literal = `${prefix}\nconst source = \`example\n// @options: {}\n\`;`;
					expect(parseCodemodeSource(literal)).toEqual({ code: literal, options: {} });
				}
			}
		}
		for (const input of [
			"const n =\nfunction() {} / `example\n// @options: {}\n`;",
			"const n =\nclass {} / `example\n// @options: {}\n`;",
			"call(\nfunction() {} / `example\n// @options: {}\n`);",
			"const n = { value:\nclass {} / `example\n// @options: {}\n` };",
		])
			expect(parseCodemodeSource(input)).toEqual({ code: input, options: {} });
	});

	it("recognizes regexps after ASI-terminated debugger, break and continue", () => {
		for (const statement of ["debugger", "break", "break outer", "continue", "continue outer"]) {
			const prefix = statement === "debugger" ? "" : "outer: while (false) { ";
			const suffix = statement === "debugger" ? "" : " }";
			for (const newline of ["\n", " /* newline\n */ ", "\r\n"]) {
				const start = `${prefix}${statement}${newline}/\`/.test('x');`;
				const input = `${start}\nconst sample = \`example\n// @options: {}\n\`;${suffix}`;
				expect(parseCodemodeSource(input)).toEqual({ code: input, options: {} });
				expect(() => parseCodemodeSource(`${start}\n// @options: {}\nreturn 1;${suffix}`)).toThrow(
					`found one on line ${start.split("\n").length + 1}`,
				);
			}
		}
		for (const name of ["debugger", "break", "continue"]) {
			const input = `obj.${name}\n/ \`example\n// @options: {}\n\`;`;
			expect(parseCodemodeSource(input)).toEqual({ code: input, options: {} });
		}
	});

	// #10631: an options line after the first line used to be ignored, so its timeout never applied.
	it("rejects an options line that is not the first line", () => {
		const cases: [string, number][] = [
			['// count things\n// @options: {"timeout_ms": 1000}\nwhile (true) {}', 2],
			['\n  // @options: {"timeout_ms": 1000}\nwhile (true) {}', 2],
			['text(1)\r\n// @options: {"timeout_ms": 1}', 2],
			['// @options: {"timeout_ms": 1}\ntext(1)\n// @options: {"timeout_ms": 2}', 3],
		];
		for (const [input, line] of cases) {
			expect(() => parseCodemodeSource(input), input).toThrow(CodemodeSourceError);
			expect(() => parseCodemodeSource(input), input).toThrow(
				`The // @options: line must be the first line of the input; found one on line ${line}`,
			);
		}
	});

	it("rejects empty input and invalid options", () => {
		const cases: [string, string | RegExp][] = [
			["", /Expected JavaScript source text \(non-empty\)/],
			["  \n", /Expected JavaScript source text \(non-empty\)/],
			["// @options:\ntext(1)", /@options must be a JSON object with supported fields/],
			["// @options: {timeout_ms: 1}\ntext(1)", /@options must be valid JSON with supported fields/],
			["// @options: [1]\ntext(1)", /@options must be a JSON object with supported fields/],
			[
				'// @options: {"yield": 1}\ntext(1)',
				"@options only supports `max_output_tokens` and `timeout_ms`; got `yield`",
			],
			[
				'// @options: {"max_output_tokens": 1.5}\ntext(1)',
				"@options field `max_output_tokens` must be a non-negative safe integer",
			],
			['// @options: {"timeout_ms": 0}\ntext(1)', /@options field `timeout_ms` must be a positive integer/],
			[
				'// @options: {"timeout_ms": 1}',
				"The @options line must be followed by JavaScript source on subsequent lines",
			],
			[
				'// @options: {"timeout_ms": 1}\n  \n',
				"The @options line must be followed by JavaScript source on subsequent lines",
			],
		];
		for (const [input, message] of cases) {
			expect(() => parseCodemodeSource(input), input).toThrow(CodemodeSourceError);
			expect(() => parseCodemodeSource(input), input).toThrow(message);
		}
	});
});
