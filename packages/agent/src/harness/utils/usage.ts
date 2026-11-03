import type { Usage } from "@earendil-works/pi-ai";

export function emptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

export function addUsage(left: Usage, right: Usage): Usage {
	let totalFromProvider: boolean | undefined;
	if (isEmptyUsage(left)) totalFromProvider = right.cost.totalFromProvider;
	else if (isEmptyUsage(right)) totalFromProvider = left.cost.totalFromProvider;
	else if (left.cost.totalFromProvider !== undefined || right.cost.totalFromProvider !== undefined)
		totalFromProvider = left.cost.totalFromProvider === true && right.cost.totalFromProvider === true;
	return {
		input: left.input + right.input,
		output: left.output + right.output,
		cacheRead: left.cacheRead + right.cacheRead,
		cacheWrite: left.cacheWrite + right.cacheWrite,
		...(left.cacheWrite1h === undefined && right.cacheWrite1h === undefined
			? {}
			: { cacheWrite1h: (left.cacheWrite1h ?? 0) + (right.cacheWrite1h ?? 0) }),
		...(left.reasoning === undefined && right.reasoning === undefined
			? {}
			: { reasoning: (left.reasoning ?? 0) + (right.reasoning ?? 0) }),
		totalTokens: left.totalTokens + right.totalTokens,
		cost: {
			input: left.cost.input + right.cost.input,
			output: left.cost.output + right.cost.output,
			cacheRead: left.cost.cacheRead + right.cost.cacheRead,
			cacheWrite: left.cost.cacheWrite + right.cost.cacheWrite,
			total: left.cost.total + right.cost.total,
			...(totalFromProvider === undefined ? {} : { totalFromProvider }),
		},
	};
}

/** Only an unmarked, zero accumulator is neutral; an explicit estimate remains a contributing charge. */
function isEmptyUsage(usage: Usage): boolean {
	return (
		usage.cost.totalFromProvider === undefined &&
		usage.input === 0 &&
		usage.output === 0 &&
		usage.cacheRead === 0 &&
		usage.cacheWrite === 0 &&
		(usage.cacheWrite1h ?? 0) === 0 &&
		(usage.reasoning ?? 0) === 0 &&
		usage.totalTokens === 0 &&
		usage.cost.input === 0 &&
		usage.cost.output === 0 &&
		usage.cost.cacheRead === 0 &&
		usage.cost.cacheWrite === 0 &&
		usage.cost.total === 0
	);
}
