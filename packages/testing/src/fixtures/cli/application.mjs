import { object } from "@optique/core/constructs";
import { argument } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { print, run } from "@optique/run";

const value = run(object({ name: argument(string()) }), {
  programName: "fixture-app",
  help: "option",
  version: "1.2.3",
});
console.log(`console:${value.name}`);
print(message`print:${value.name}`);
process.stdout.write("raw\n");
