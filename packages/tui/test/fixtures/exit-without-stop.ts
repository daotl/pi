import { ProcessTerminal } from "../../src/terminal.ts";
import { TuiAltScreen } from "../../src/tui-alt-screen.ts";

const tui = new TuiAltScreen(new ProcessTerminal(), false, undefined, { mouse: true });
tui.start();
tui.terminal.setProgramStatus({ state: "blocked", kind: "question", message: "Waiting" });
if (process.argv[2] === "stop") tui.stop({ preserveScreen: true });
process.exit(0);
