import { hostNamed, method, remote } from "@earendil-works/chord";
import { Type } from "typebox";

export const ExampleFacetService = remote("pi.example-plugin.greeting", {
	version: 1,
	input: Type.Object({}),
	host: hostNamed("session"),
	variants: {
		greeting: {
			state: { workerActivations: Type.Object({ count: Type.Integer({ minimum: 0 }) }) },
			methods: {
				greet: method(
					Type.Object({ name: Type.String() }),
					Type.Object({
						message: Type.String(),
						workerActivations: Type.Integer({ minimum: 0 }),
					}),
				),
			},
		},
	},
});
