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
