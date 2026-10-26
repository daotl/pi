import { defineFacet } from "@earendil-works/chord";
import { ExampleFacetService } from "./contract.ts";

let activations = 0;

export default defineFacet(({ serve }) => {
	serve(ExampleFacetService, (_input, _principal, self) => {
		const workerActivations = self.state(
			"workerActivations",
			ExampleFacetService.def.variants.greeting.state.workerActivations,
			{ init: () => ({ count: ++activations }) },
		);
		return {
			variant: "greeting",
			workerActivations,
			async greet({ name }) {
				return {
					message: `Hello ${name} from the bundled Session worker facet!!!`,
					workerActivations: workerActivations.value.count,
				};
			},
		};
	});
});
