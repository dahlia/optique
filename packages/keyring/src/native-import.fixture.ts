import assert from "node:assert/strict";
import { AsyncEntry } from "@napi-rs/keyring";

assert.equal(typeof AsyncEntry, "function");
