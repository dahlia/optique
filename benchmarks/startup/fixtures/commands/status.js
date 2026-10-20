import { defineCommand } from "@optique/discover";
import { status } from "../grammar.js";
import { handler } from "../handlers/status.js";

export default defineCommand({ parser: status(), handler });
