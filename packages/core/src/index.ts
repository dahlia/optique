export {
  annotationKey,
  type Annotations,
  getAnnotations,
  type ParseOptions,
} from "./annotations.ts";
export * from "./completion.ts";
export * from "./dependency.ts";
export * from "./doc.ts";
export * from "./facade.ts";
export {
  commandLine,
  envVar,
  formatMessage,
  link,
  type Message,
  message,
  type MessageFormatOptions,
  type MessageTerm,
  metavar,
  optionName,
  optionNames,
  text,
  // url is NOT re-exported here to avoid conflict with valueparser.ts url()
  // Import from "@optique/core/message" directly to use url(), or use link()
  value,
  values,
  valueSet,
  type ValueSetOptions,
} from "./message.ts";
export * from "./parser.ts";
export * from "./usage.ts";
export * from "./valueparser.ts";
