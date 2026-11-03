const { writeFileSync } = require("node:fs");

writeFileSync(process.argv[2], "ran");
process.send("written", (error) => {
	if (error) throw error;
	process.disconnect();
});
