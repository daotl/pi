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
	const braces: boolean[] = [];
	const parentheses: boolean[] = [];
	let control = false;
	let member = false;
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
			index++;
			continue;
		}
		if (template) {
			if (char === "$" && input[index + 1] === "{") {
				braces.push(true);
				template = false;
				expressionStart = true;
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
				if (input[index++] === "\n") line++;
			}
			index += 2;
			continue;
		}
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
			continue;
		}
		if ((char === "+" || char === "-") && input[index + 1] === char) {
			index += 2;
			continue;
		}
		if (char === "(") {
			parentheses.push(control);
			control = false;
			expressionStart = true;
			index++;
			continue;
		}
		if (char === ")") {
			expressionStart = parentheses.pop() ?? false;
			index++;
			continue;
		}
		if (/[\w$]/.test(char)) {
			const start = index++;
			while (index < input.length && /[\w$]/.test(input[index])) index++;
			expressionStart =
				!member &&
				/^(?:return|throw|case|delete|void|typeof|new|in|of|yield|await|instanceof)$/.test(
					input.slice(start, index),
				);
			control = !member && /^(?:if|while|for|with|switch|catch)$/.test(input.slice(start, index));
			member = false;
			continue;
		}
		if (char === "{") braces.push(false);
		if (char === "}" && braces.pop()) template = true;
		if (!/\s/.test(char)) control = false;
		if (!/\s/.test(char)) member = char === ".";
		if (!/\s/.test(char)) expressionStart = !/[)\]}.]/.test(char);
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
