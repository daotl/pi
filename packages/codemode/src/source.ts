/**
 * Codemode source format: JavaScript, optionally preceded by one options line.
 *
 * ```js
 * // @options: {"max_output_tokens": 2000, "timeout_ms": 30000}
 * const text = await tools.read({ path: "package.json" });
 * text(JSON.parse(text).name);
 * ```
 */

export const CODEMODE_OPTIONS_PREFIX = "// @options:";

const SUPPORTED_FIELDS = ["max_output_tokens", "timeout_ms"] as const;
const SUPPORTED_FIELDS_TEXT = "`max_output_tokens` and `timeout_ms`";
/** Largest delay `setTimeout` supports, which bounds `timeout_ms`. */
const MAX_TIMEOUT_MS = 2_147_483_647;
// Numbers retain the scanner's word treatment; identifiers also include Unicode and escaped characters.
const SOURCE_WORD =
	/(?:[$_\p{ID_Start}\d]|\\u(?:[\da-fA-F]{4}|\{[\da-fA-F]+\}))(?:[$\p{ID_Continue}]|\u200C|\u200D|\\u(?:[\da-fA-F]{4}|\{[\da-fA-F]+\}))*/uy;
const IDENTIFIER_ESCAPE = /\\u(?:([\da-fA-F]{4})|\{([\da-fA-F]+)\})/g;

/**
 * Lark grammar for providers with grammar-constrained tool input. It only fixes the shape of the
 * options line; the options JSON and the code are checked by {@link parseCodemodeSource}.
 */
export const CODEMODE_SOURCE_GRAMMAR = String.raw`
start: options_source | plain_source
options_source: OPTIONS_LINE NEWLINE SOURCE
plain_source: SOURCE

OPTIONS_LINE: /[ \t]*\/\/ @options:[^\r\n]*/
NEWLINE: /\r?\n/
SOURCE: /[\s\S]+/
`;

export interface CodemodeSourceOptions {
	/** Token budget for the script's output. */
	maxOutputTokens?: number;
	/** Hard deadline for the whole script in milliseconds, including tool calls. */
	timeoutMs?: number;
}

export interface ParsedCodemodeSource {
	/** The script with the options line replaced by an empty line, so line numbers are unchanged. */
	code: string;
	options: CodemodeSourceOptions;
}

export class CodemodeSourceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CodemodeSourceError";
	}
}

function isSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseOptions(directive: string): CodemodeSourceOptions {
	if (directive === "") {
		throw new CodemodeSourceError(`@options must be a JSON object with supported fields ${SUPPORTED_FIELDS_TEXT}`);
	}
	let value: unknown;
	try {
		value = JSON.parse(directive);
	} catch (error) {
		throw new CodemodeSourceError(
			`@options must be valid JSON with supported fields ${SUPPORTED_FIELDS_TEXT}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new CodemodeSourceError(`@options must be a JSON object with supported fields ${SUPPORTED_FIELDS_TEXT}`);
	}
	const fields = value as Record<string, unknown>;
	for (const key of Object.keys(fields)) {
		if (!(SUPPORTED_FIELDS as readonly string[]).includes(key)) {
			throw new CodemodeSourceError(`@options only supports ${SUPPORTED_FIELDS_TEXT}; got \`${key}\``);
		}
	}
	const options: CodemodeSourceOptions = {};
	const { max_output_tokens, timeout_ms } = fields;
	if (max_output_tokens !== undefined) {
		if (!isSafeInteger(max_output_tokens)) {
			throw new CodemodeSourceError("@options field `max_output_tokens` must be a non-negative safe integer");
		}
		options.maxOutputTokens = max_output_tokens;
	}
	if (timeout_ms !== undefined) {
		if (!isSafeInteger(timeout_ms) || timeout_ms === 0 || timeout_ms > MAX_TIMEOUT_MS) {
			throw new CodemodeSourceError(
				`@options field \`timeout_ms\` must be a positive integer up to ${MAX_TIMEOUT_MS}`,
			);
		}
		options.timeoutMs = timeout_ms;
	}
	return options;
}

/** Find directive comments, not matching text in strings, templates, regexps or block comments. */
function misplacedOptionsLine(input: string): number | undefined {
	let line = 1;
	let index = 0;
	let template = false;
	let expressionStart = true;
	// A block ends a statement; an object or function expression still permits division.
	type Brace =
		| "block"
		| "object"
		| "function"
		| "template"
		| "class-member"
		| {
				kind: "class-declaration" | "class-expression";
				phase: "member" | "initializer";
				parentheses: number;
				brackets: number;
		  };
	const braces: Brace[] = [];
	const parentheses: ("control" | "expression" | "declaration" | "function" | "method")[] = [];
	let brackets = 0;
	let lineBreak = false;
	let statementStart = true;
	let functionParameters: "declaration" | "function" | undefined;
	let nextBrace: "block" | "function" | "class-member" | undefined;
	const classBodies: { braces: number; parentheses: number; declaration: boolean }[] = [];
	const objectBodies: { braces: number; parentheses: number; brackets: number; property: boolean }[] = [];
	const statementScopes = [{ braces: 0, parentheses: 0, brackets: 0 }];
	let control = false;
	let member = false;
	let label = false;
	while (index < input.length) {
		const char = input[index];
		if (char === "\n") line++;
		if (char === "\\" && template) {
			if (input[index + 1] === "\n") line++;
			index += 2;
			continue;
		}
		if (char === "`") {
			template = !template;
			expressionStart = false;
			statementStart = false;
			nextBrace = undefined;
			lineBreak = false;
			index++;
			continue;
		}
		if (template) {
			if (char === "$" && input[index + 1] === "{") {
				braces.push("template");
				template = false;
				expressionStart = true;
				statementStart = false;
				index += 2;
			} else index++;
			continue;
		}
		if (char === "/" && input[index + 1] === "/") {
			if (
				line > 1 &&
				input.startsWith(CODEMODE_OPTIONS_PREFIX, index) &&
				input.slice(input.lastIndexOf("\n", index - 1) + 1, index).trim() === ""
			)
				return line;
			while (index < input.length && input[index] !== "\n") index++;
			continue;
		}
		if (char === "/" && input[index + 1] === "*") {
			index += 2;
			while (index < input.length && !(input[index] === "*" && input[index + 1] === "/")) {
				const skipped = input[index++];
				if (skipped === "\n") line++;
				if (/[\r\n\u2028\u2029]/.test(skipped)) lineBreak = true;
			}
			index += 2;
			continue;
		}
		if (/\s/.test(char)) {
			if (/[\r\n\u2028\u2029]/.test(char)) lineBreak = true;
			index++;
			continue;
		}
		SOURCE_WORD.lastIndex = index;
		const token = SOURCE_WORD.exec(input)?.[0];
		const wordEnd = SOURCE_WORD.lastIndex;
		const word = token?.replace(
			IDENTIFIER_ESCAPE,
			(encoded: string, fixed: string | undefined, braced: string | undefined) => {
				const point = Number.parseInt(fixed ?? braced!, 16);
				return point <= 0x10ffff ? String.fromCodePoint(point) : encoded;
			},
		);
		const enclosing = braces.at(-1);
		const classBody =
			typeof enclosing === "object" &&
			enclosing.parentheses === parentheses.length &&
			enclosing.brackets === brackets
				? enclosing
				: undefined;
		const objectBody = objectBodies.at(-1);
		const directObject =
			objectBody?.braces === braces.length &&
			objectBody.parentheses === parentheses.length &&
			objectBody.brackets === brackets
				? objectBody
				: undefined;
		// ASI also separates a completed statement expression from a following
		// declaration. Restrict this to statement-list depth: a newline in a call,
		// object value, class header or field must not turn an expression into a declaration.
		const statementScope = statementScopes.at(-1)!;
		if (
			lineBreak &&
			!expressionStart &&
			!member &&
			!functionParameters &&
			classBodies.at(-1)?.braces !== braces.length &&
			statementScope.braces === braces.length &&
			statementScope.parentheses === parentheses.length &&
			statementScope.brackets === brackets &&
			word !== undefined &&
			!/^(?:in|instanceof)$/.test(word)
		) {
			statementStart = true;
		}
		// A newline ends an initialized field only when its expression has ended and the
		// next token cannot continue it. Calls, indexing, tagged templates and division
		// still continue across newlines; class/function headers are not complete values.
		if (
			classBody?.phase === "initializer" &&
			lineBreak &&
			!expressionStart &&
			!member &&
			!functionParameters &&
			classBodies.at(-1)?.braces !== braces.length &&
			((word !== undefined && word !== "in" && word !== "instanceof") ||
				char === '"' ||
				char === "'" ||
				char === "#")
		) {
			classBody.phase = "member";
			statementStart = false;
		}
		lineBreak = false;
		const body = nextBrace;
		nextBrace = undefined;
		const labelColon = label && char === ":";
		label = false;
		if (char === '"' || char === "'" || (char === "/" && expressionStart)) {
			const delimiter = char;
			let characterClass = false;
			index++;
			while (index < input.length) {
				const next = input[index++];
				if (next === "\n") line++;
				if (next === "\\") {
					if (input[index++] === "\n") line++;
				} else if (delimiter === "/" && next === "[") characterClass = true;
				else if (delimiter === "/" && next === "]") characterClass = false;
				else if (next === delimiter && !characterClass) break;
			}
			expressionStart = false;
			statementStart = false;
			member = false;
			continue;
		}
		if ((char === "+" || char === "-") && input[index + 1] === char) {
			index += 2;
			continue;
		}
		if (char === "=" && input[index + 1] === ">") {
			nextBrace = "function";
			expressionStart = true;
			statementStart = false;
			index += 2;
			continue;
		}
		if (char === "(") {
			parentheses.push(
				functionParameters ??
					(classBody?.phase === "member" || directObject?.property
						? "method"
						: control
							? "control"
							: "expression"),
			);
			functionParameters = undefined;
			control = false;
			expressionStart = true;
			statementStart = false;
			index++;
			continue;
		}
		if (char === ")") {
			const context = parentheses.pop();
			expressionStart = context === "control";
			statementStart = expressionStart;
			if (context === "control" || context === "declaration") nextBrace = "block";
			else if (context === "function") nextBrace = "function";
			else if (context === "method") nextBrace = "class-member";
			index++;
			continue;
		}
		if (word !== undefined) {
			index = wordEnd;
			const classMember = classBody?.phase === "member";
			if (classMember || directObject?.property) {
				// Modifiers and keyword-named class/object members remain property names
				// until a field initializer or object property value starts.
				expressionStart = false;
				statementStart = false;
				control = false;
				member = false;
				continue;
			}
			label = statementStart && !member;
			if (!member && word === "function") {
				functionParameters = statementStart ? "declaration" : "function";
			}
			if (!member && word === "class") {
				classBodies.push({ braces: braces.length, parentheses: parentheses.length, declaration: statementStart });
			}
			const statementKeyword = !member && /^(?:else|do|try|finally|catch)$/.test(word);
			expressionStart =
				statementKeyword ||
				(!member && /^(?:return|throw|case|delete|void|typeof|new|in|of|yield|await|instanceof)$/.test(word));
			control = !member && /^(?:if|while|for|with|switch|catch)$/.test(word);
			// async can precede a function declaration without changing its statement context.
			statementStart = statementKeyword || (!member && /^(?:async|export|default)$/.test(word) && statementStart);
			member = false;
			continue;
		}
		if (char === "{") {
			const pendingClass = classBodies.at(-1);
			const pendingBody =
				pendingClass?.braces === braces.length && pendingClass.parentheses === parentheses.length
					? classBodies.pop()
					: undefined;
			const context = pendingBody
				? pendingBody.declaration
					? "class-declaration"
					: "class-expression"
				: (body ?? (classBody?.phase === "member" ? "class-member" : statementStart ? "block" : "object"));
			if (context === "class-declaration" || context === "class-expression") {
				braces.push({ kind: context, phase: "member", parentheses: parentheses.length, brackets });
			} else braces.push(context);
			if (context === "object") {
				objectBodies.push({ braces: braces.length, parentheses: parentheses.length, brackets, property: true });
			}
			expressionStart = true;
			statementStart = context === "block" || context === "function" || context === "class-member";
			if (statementStart) statementScopes.push({ braces: braces.length, parentheses: parentheses.length, brackets });
		} else if (char === "}") {
			if (statementScopes.at(-1)?.braces === braces.length) statementScopes.pop();
			if (objectBodies.at(-1)?.braces === braces.length) objectBodies.pop();
			const brace = braces.pop();
			const context = typeof brace === "object" ? brace.kind : brace;
			template = context === "template";
			expressionStart = context === "block" || context === "class-declaration";
			statementStart = expressionStart;
			if (context === "class-member") {
				const owner = braces.at(-1);
				if (typeof owner === "object") owner.phase = "member";
				statementStart = false;
			}
		} else {
			if (directObject) {
				if (char === ",") directObject.property = true;
				else if (char === ":" || (char === "." && input[index + 1] === ".")) directObject.property = false;
			}
			if (char === "[") brackets++;
			else if (char === "]") brackets--;
			if (classBody && char === ";") classBody.phase = "member";
			else if (classBody?.phase === "member" && char === "=") classBody.phase = "initializer";
			expressionStart = char !== "]" && char !== "." && char !== "#";
			statementStart = (char === ";" && !classBody) || labelColon;
		}
		control = false;
		member = char === "." || char === "#";
		index++;
	}
	return undefined;
}

/**
 * Split an optional first-line `// @options: {...}` from the script. Throws
 * {@link CodemodeSourceError} for empty input, invalid options, and an options line that is not the
 * first line, which would otherwise be ignored without notice.
 */
export function parseCodemodeSource(input: string): ParsedCodemodeSource {
	if (input.trim() === "") {
		throw new CodemodeSourceError(
			'Expected JavaScript source text (non-empty). Provide JS only, optionally with a first line `// @options: {"max_output_tokens": 1000}`.',
		);
	}
	const misplaced = misplacedOptionsLine(input);
	if (misplaced !== undefined) {
		throw new CodemodeSourceError(
			`The ${CODEMODE_OPTIONS_PREFIX} line must be the first line of the input; found one on line ${misplaced}`,
		);
	}
	const newline = input.indexOf("\n");
	const firstLine = (newline === -1 ? input : input.slice(0, newline)).replace(/\r$/, "");
	const trimmed = firstLine.trimStart();
	if (!trimmed.startsWith(CODEMODE_OPTIONS_PREFIX)) return { code: input, options: {} };
	const code = newline === -1 ? "" : input.slice(newline);
	if (code.trim() === "") {
		throw new CodemodeSourceError("The @options line must be followed by JavaScript source on subsequent lines");
	}
	return { code, options: parseOptions(trimmed.slice(CODEMODE_OPTIONS_PREFIX.length).trim()) };
}
