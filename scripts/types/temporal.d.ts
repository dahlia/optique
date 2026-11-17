import { Temporal as PolyfillTemporal } from "@js-temporal/polyfill";

declare global {
  // Re-export the actual namespace (types and constructors), not a handwritten
  // approximation. This file belongs only to the standalone Node checker.
  export import Temporal = PolyfillTemporal;
}
