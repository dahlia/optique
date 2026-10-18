import { defineCommand } from "@optique/discover";
import { start } from "../grammar.js";
import { handler } from "../handlers/start.js";

export default defineCommand({ parser: start(), handler });
