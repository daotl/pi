import { defineFacet, local } from "@earendil-works/chord";
import { AgentController, PresentationUI, SlashCommands } from "@earendil-works/pi-coding-agent/experimental/plugin";
import { Type } from "typebox";
import { ExampleFacetService } from "./contract.ts";

const Commands = local("pi.example-plugin.commands", { version: 1, input: Type.Object({}) });

export default defineFacet(({ serve }) => {
	serve(
		Commands,
		(_input, _principal, self) => {
			const example = self.get(ExampleFacetService, {});
			const commands = self.get(SlashCommands, {});
			const controller = self.get(AgentController, {});
			const ui = self.get(PresentationUI, {});
			self.resource("hello-command", {
				version: 1,
				deps: [example, commands, controller, ui],
				open() {
					return commands.registry!.replace({
						name: "hello",
						description: "Call the bundled Session worker facet",
						argumentHint: "<name>",
						async run(args, context) {
							const message = args.length === 0 ? "from the TUI" : args;
							const reply = await example.greet({ name: message }, context);
							ui.ui!.showStatus(
								`We got this: ${reply.message} Worker activations: ${reply.workerActivations}.`,
								context,
							);
							return controller.prompt({ message: `pong: ${message}`, images: null }, context);
						},
					});
				},
				close: (unregister) => unregister(),
			});
			return {};
		},
		{ lifetime: "host" },
	);
});
