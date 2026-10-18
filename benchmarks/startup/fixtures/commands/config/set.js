import { defineCommand } from "@optique/discover";
import { set } from "../../grammar.js";
import { handler } from "../../handlers/set.js";

export default defineCommand({ parser: set(), handler });
