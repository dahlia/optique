import {
  bash,
  fish,
  nu,
  pwsh,
  type ShellCompletion,
  zsh,
} from "./completion.ts";
import { group, longestMatch, object } from "./constructs.ts";
import {
  type DocPage,
  type DocSection,
  formatDocPage,
  type ShowChoicesOptions,
  type ShowDefaultOptions,
} from "./doc.ts";
import {
  commandLine,
  formatMessage,
  lineBreak,
  type Message,
  message,
  type MessageTerm,
  optionName,
  text,
  value,
} from "./message.ts";
import { multiple, optional, withDefault } from "./modifiers.ts";
import type { Program } from "./program.ts";
import {
  getDocPage,
  type InferMode,
  type InferValue,
  type Mode,
  type ModeValue,
  parseAsync,
  type Parser,
  type ParserResult,
  parseSync,
  type Result,
  suggest,
  suggestAsync,
} from "./parser.ts";
import { dispatchByMode } from "./mode-dispatch.ts";
import { argument, command, constant, flag, option } from "./primitives.ts";
import {
  formatUsage,
  type HiddenVisibility,
  type OptionName,
  type Usage,
} from "./usage.ts";
import { string } from "./valueparser.ts";
import { type Annotations, injectAnnotations } from "./annotations.ts";
import {
  containsPlaceholderValues,
  isPlaceholderValue,
  type ParserValuePlaceholder,
  type SourceContext,
} from "./context.ts";

export type { ParserValuePlaceholder, SourceContext };

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function shouldSkipCollectionOwnKey(
  value: object,
  key: PropertyKey,
): boolean {
  if (Array.isArray(value)) {
    return key === "length" ||
      (typeof key === "string" &&
        Number.isInteger(Number(key)) &&
        String(Number(key)) === key);
  }
  return false;
}

function copySanitizedOwnProperties(
  source: object,
  target: object,
  seen: WeakMap<object, unknown>,
): void {
  for (const key of Reflect.ownKeys(source)) {
    if (shouldSkipCollectionOwnKey(source, key)) {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (descriptor == null) {
      continue;
    }
    if ("value" in descriptor) {
      descriptor.value = stripPlaceholderValues(
        descriptor.value,
        seen,
      );
    }
    Object.defineProperty(target, key, descriptor);
  }
}

function createArrayCloneLike(value: readonly unknown[]): unknown[] {
  try {
    const arrayCtor = value.constructor as abstract new (
      length?: number,
    ) => unknown[];
    return Reflect.construct(
      Array,
      [value.length],
      arrayCtor,
    ) as unknown[];
  } catch {
    return new Array(value.length);
  }
}

function createSetCloneLike(value: Set<unknown>): Set<unknown> {
  try {
    const setCtor = value.constructor as abstract new (
      iterable?: Iterable<unknown>,
    ) => Set<unknown>;
    return Reflect.construct(
      Set,
      [],
      setCtor,
    ) as Set<unknown>;
  } catch {
    return new Set<unknown>();
  }
}

function createMapCloneLike(
  value: Map<unknown, unknown>,
): Map<unknown, unknown> {
  try {
    const mapCtor = value.constructor as abstract new (
      iterable?: Iterable<readonly [unknown, unknown]>,
    ) => Map<unknown, unknown>;
    return Reflect.construct(
      Map,
      [],
      mapCtor,
    ) as Map<unknown, unknown>;
  } catch {
    return new Map<unknown, unknown>();
  }
}

function stripPlaceholderValues<T>(
  value: T,
  seen = new WeakMap<object, unknown>(),
): T {
  if (isPlaceholderValue(value)) {
    return undefined as T;
  }
  if (value == null || typeof value !== "object") {
    return value;
  }
  const cached = seen.get(value);
  if (cached !== undefined) {
    return cached as T;
  }
  if (Array.isArray(value)) {
    if (!containsPlaceholderValues(value)) {
      return value;
    }
    const clone = createArrayCloneLike(value);
    seen.set(value, clone);
    for (let i = 0; i < value.length; i++) {
      clone[i] = stripPlaceholderValues(value[i], seen);
    }
    copySanitizedOwnProperties(value, clone, seen);
    return clone as T;
  }
  if (value instanceof Set) {
    if (!containsPlaceholderValues(value)) {
      return value;
    }
    const clone = createSetCloneLike(value);
    seen.set(value, clone);
    for (const entryValue of value) {
      clone.add(
        stripPlaceholderValues(entryValue, seen),
      );
    }
    copySanitizedOwnProperties(value, clone, seen);
    return clone as T;
  }
  if (value instanceof Map) {
    if (!containsPlaceholderValues(value)) {
      return value;
    }
    const clone = createMapCloneLike(value);
    seen.set(value, clone);
    for (const [key, entryValue] of value) {
      clone.set(
        stripPlaceholderValues(key, seen),
        stripPlaceholderValues(entryValue, seen),
      );
    }
    copySanitizedOwnProperties(value, clone, seen);
    return clone as T;
  }
  if (!isPlainObject(value)) {
    if (!containsPlaceholderValues(value)) {
      return value;
    }
    return createSanitizedNonPlainView(value, seen) as T;
  }
  const clone: Record<PropertyKey, unknown> = Object.create(
    Object.getPrototypeOf(value),
  );
  seen.set(value, clone);
  // Map the clone to itself so that wrapped methods returning the clone
  // (e.g., `self() { return this; }`) are recognized by
  // stripPlaceholderValues() and not re-cloned, preserving identity.
  seen.set(clone, clone);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor == null) {
      continue;
    }
    if ("value" in descriptor) {
      // Constructable functions (classes, traditional constructors) are
      // left unwrapped to preserve static-method `this` binding and
      // constructor identity.  Non-constructable functions (arrow
      // functions, method shorthand, bound callbacks) are wrapped so
      // that closures capturing placeholder values have their return
      // values sanitized.  Bound constructors lose their .prototype
      // and are wrapped; the wrapper delegates `new` via new.target.
      // See: https://github.com/dahlia/optique/issues/407
      const fnVal = descriptor.value;
      const fnProto = typeof fnVal === "function"
        ? (fnVal as { prototype?: unknown }).prototype
        : undefined;
      const isConstructable = typeof fnVal === "function" &&
        fnProto != null && typeof fnProto === "object";
      if (typeof fnVal === "function" && !isConstructable) {
        const fn = descriptor.value as {
          apply(thisArg: unknown, args: unknown[]): unknown;
        };
        const wrapper = function (
          this: unknown,
          ...args: unknown[]
        ) {
          if (new.target) {
            return Reflect.construct(
              fn as (...a: unknown[]) => unknown,
              args,
              new.target === wrapper
                ? fn as (...a: unknown[]) => unknown
                : new.target,
            );
          }
          const result = fn.apply(this, args);
          if (result instanceof Promise) {
            return (result as Promise<unknown>).then(
              (v) => stripPlaceholderValues(v, seen),
            );
          }
          return stripPlaceholderValues(result, seen);
        };
        // Copy own properties (.prototype, .name, .length, statics)
        // from the original so instanceof and identity checks work.
        for (const fk of Reflect.ownKeys(fn as object)) {
          const fd = Object.getOwnPropertyDescriptor(fn, fk);
          if (fd == null) continue;
          try {
            Object.defineProperty(wrapper, fk, fd);
          } catch { /* best-effort */ }
        }
        descriptor.value = wrapper;
      } else {
        descriptor.value = stripPlaceholderValues(
          descriptor.value,
          seen,
        );
      }
    }
    Object.defineProperty(clone, key, descriptor);
  }
  return clone as T;
}

function finalizeParsedForContext(
  context: SourceContext<unknown>,
  parsed: unknown,
): unknown {
  return context.finalizeParsed != null
    ? context.finalizeParsed(parsed)
    : parsed;
}

const SANITIZE_FAILED: unique symbol = Symbol("sanitizeFailed");

interface ActiveSanitization {
  readonly saved: Map<PropertyKey, PropertyDescriptor>;
  readonly sanitizedValues: Map<PropertyKey, unknown>;
  count: number;
}

const activeSanitizations = new WeakMap<object, ActiveSanitization>();

function callWithSanitizedOwnProperties(
  target: object,
  fn: { apply(thisArg: unknown, args: unknown[]): unknown },
  args: unknown[],
  strip: <V>(value: V, seen: WeakMap<object, unknown>) => V,
  seen: WeakMap<object, unknown>,
): unknown | typeof SANITIZE_FAILED {
  let active = activeSanitizations.get(target);
  if (active != null) {
    // Properties are already sanitized by a concurrent call; just
    // increment the reference count so we defer restoration.
    active.count++;
  } else {
    const saved = new Map<PropertyKey, PropertyDescriptor>();
    const sanitizedValues = new Map<PropertyKey, unknown>();
    for (const key of Reflect.ownKeys(target)) {
      const desc = Object.getOwnPropertyDescriptor(target, key);
      if (desc != null && "value" in desc) {
        let stripped: unknown;
        try {
          stripped = strip(desc.value, seen);
        } catch {
          // strip() failed; roll back and bail.
          for (const [k, d] of saved) {
            try {
              Object.defineProperty(target, k, d);
            } catch {
              // Best-effort rollback.
            }
          }
          return SANITIZE_FAILED;
        }
        if (stripped !== desc.value) {
          try {
            Object.defineProperty(target, key, { ...desc, value: stripped });
            saved.set(key, desc);
            sanitizedValues.set(key, stripped);
          } catch {
            // Property is non-configurable or object is frozen; cannot
            // safely call the method with unsanitized state.
            for (const [k, d] of saved) {
              try {
                Object.defineProperty(target, k, d);
              } catch {
                // Best-effort rollback.
              }
            }
            return SANITIZE_FAILED;
          }
        }
      }
    }
    active = { saved, sanitizedValues, count: 1 };
    activeSanitizations.set(target, active);
  }

  function release(): void {
    active!.count--;
    if (active!.count === 0) {
      activeSanitizations.delete(target);
      for (const [key, desc] of active!.saved) {
        try {
          // Only restore if the method did not mutate or delete the
          // property.  Compare against the exact sanitized value that was
          // set, not a re-computed strip() which would create a new clone.
          const current = Object.getOwnPropertyDescriptor(target, key);
          if (current == null) continue; // method deleted the property
          if (
            "value" in current &&
            current.value !== active!.sanitizedValues.get(key)
          ) {
            continue; // method wrote a new value
          }
          Object.defineProperty(target, key, desc);
        } catch {
          // The method may have frozen, sealed, or redefined this
          // property; best-effort restoration.
        }
      }
    }
  }

  let result: unknown;
  try {
    result = fn.apply(target, args);
  } catch (e) {
    release();
    throw e;
  }

  // If the method returns a real Promise (async method), defer restoration
  // until the promise settles so that awaited continuations still observe
  // the sanitized property values.  Custom thenables are not assimilated
  // to avoid coercing non-Promise return types.
  if (result instanceof Promise) {
    return (result as Promise<unknown>).then(
      (v) => {
        release();
        return strip(v, seen);
      },
      (e) => {
        release();
        throw e;
      },
    );
  }

  release();
  return strip(result, seen);
}

function callMethodOnSanitizedTarget(
  fn: { apply(thisArg: unknown, args: unknown[]): unknown },
  proxy: object,
  target: object,
  args: unknown[],
  strip: <V>(value: V, seen: WeakMap<object, unknown>) => V,
  seen: WeakMap<object, unknown>,
): unknown {
  // All methods are called on the target with temporarily sanitized own
  // properties.  This handles private fields (which require target as
  // receiver), Promise-returning methods, and native async methods
  // uniformly, without retrying or detecting function types.
  const result = callWithSanitizedOwnProperties(
    target,
    fn,
    args,
    strip,
    seen,
  );
  if (result !== SANITIZE_FAILED) return result;

  // SANITIZE_FAILED means the target is frozen/sealed and its properties
  // cannot be temporarily replaced.  Fall back to the proxy path, which
  // handles methods that don't access private fields.  Private-field
  // methods on frozen objects will propagate the TypeError.
  const fallback = fn.apply(proxy, args);
  if (fallback instanceof Promise) {
    return (fallback as Promise<unknown>).then((v) => strip(v, seen));
  }
  return strip(fallback, seen);
}

function createSanitizedNonPlainView<T extends object>(
  value: T,
  seen: WeakMap<object, unknown>,
): T {
  // NOTE: Methods are invoked on the original target with temporarily
  // sanitized own properties via callMethodOnSanitizedTarget().  This
  // allows private field access (which requires the real instance as
  // receiver) while ensuring public placeholder-value fields are scrubbed.
  // See: https://github.com/dahlia/optique/issues/307
  const methodCache = new Map<
    PropertyKey,
    { fn: unknown; wrapper: (...args: unknown[]) => unknown }
  >();
  const proxy: T = new Proxy(value, {
    get(target, key, receiver) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (descriptor != null && "value" in descriptor) {
        // Non-configurable non-writable properties must return the exact
        // value to satisfy the proxy invariant.
        if (!descriptor.configurable && !descriptor.writable) {
          return descriptor.value;
        }
        const val = stripPlaceholderValues(
          descriptor.value,
          seen,
        );
        if (typeof val === "function") {
          // For non-configurable non-writable properties, the proxy invariant
          // requires returning the exact value.  Class constructors are also
          // returned unwrapped since the wrapper would break new.target and
          // prototype chain semantics when invoked with `new`.
          if (
            (!descriptor.configurable && !descriptor.writable) ||
            /^class[\s{]/.test(Function.prototype.toString.call(val))
          ) {
            return val;
          }
          // Own function-valued properties (class fields, constructor-
          // assigned methods) need the sanitized-target wrapper just like
          // prototype methods.  Cached and invalidated when the underlying
          // function changes.
          const cached = methodCache.get(key);
          if (cached != null && cached.fn === val) return cached.wrapper;
          const wrapper = function (this: unknown, ...args: unknown[]) {
            if (this !== proxy) {
              return stripPlaceholderValues(
                val.apply(this, args),
                seen,
              );
            }
            return callMethodOnSanitizedTarget(
              val,
              proxy,
              target,
              args,
              stripPlaceholderValues,
              seen,
            );
          };
          methodCache.set(key, { fn: val, wrapper });
          return wrapper;
        }
        return val;
      }
      // Accessor properties and prototype methods: resolved via Reflect.get.
      // Only prototype data methods are cached; accessor-returned functions
      // are re-created on each access since the getter may return different
      // functions based on backing state.  Walk the prototype chain to
      // detect inherited getters, not just own accessors.
      let isAccessor = false;
      for (
        let proto: object | null = target;
        proto != null;
        proto = Object.getPrototypeOf(proto)
      ) {
        const d = Object.getOwnPropertyDescriptor(proto, key);
        if (d != null) {
          isAccessor = "get" in d;
          break;
        }
      }
      // Invoke the getter via callMethodOnSanitizedTarget so that own
      // properties are temporarily sanitized.  The synthetic function maps
      // thisArg back to the original receiver so standard Reflect.get
      // receiver semantics are preserved.  Private field access through
      // the proxy receiver throws TypeError which propagates to the
      // caller — use methods for private field access instead.
      const result = callMethodOnSanitizedTarget(
        {
          apply: (thisArg: unknown) =>
            Reflect.get(
              target,
              key,
              thisArg === target ? receiver : (thisArg ?? target),
            ),
        },
        receiver,
        target,
        [],
        stripPlaceholderValues,
        seen,
      );
      if (typeof result === "function") {
        // Class constructors are returned unwrapped since the wrapper
        // would break new.target and prototype chain semantics.
        if (/^class[\s{]/.test(Function.prototype.toString.call(result))) {
          return result;
        }
        if (!isAccessor) {
          const cached = methodCache.get(key);
          if (cached != null && cached.fn === result) return cached.wrapper;
          const wrapper = function (this: unknown, ...args: unknown[]) {
            if (this !== proxy) {
              return stripPlaceholderValues(
                result.apply(this, args),
                seen,
              );
            }
            return callMethodOnSanitizedTarget(
              result,
              proxy,
              target,
              args,
              stripPlaceholderValues,
              seen,
            );
          };
          methodCache.set(key, { fn: result, wrapper });
          return wrapper;
        }
        // Accessor-returned function: wrap without caching.
        return function (this: unknown, ...args: unknown[]) {
          if (this !== proxy) {
            return stripPlaceholderValues(
              result.apply(this, args),
              seen,
            );
          }
          return callMethodOnSanitizedTarget(
            result,
            proxy,
            target,
            args,
            stripPlaceholderValues,
            seen,
          );
        };
      }
      return stripPlaceholderValues(result, seen);
    },
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (descriptor == null || !("value" in descriptor)) {
        return descriptor;
      }
      // Non-configurable non-writable properties must return the exact
      // value to satisfy the proxy invariant.
      if (!descriptor.configurable && !descriptor.writable) {
        return descriptor;
      }
      return {
        ...descriptor,
        value: stripPlaceholderValues(descriptor.value, seen),
      };
    },
  });
  seen.set(value, proxy);
  return proxy;
}

function prepareParsedForContexts(
  parsed: unknown,
): unknown {
  if (parsed == null || typeof parsed !== "object") {
    return stripPlaceholderValues(parsed);
  }

  if (isPlaceholderValue(parsed)) {
    return undefined;
  }

  if (
    Array.isArray(parsed) ||
    parsed instanceof Set ||
    parsed instanceof Map
  ) {
    if (!containsPlaceholderValues(parsed)) {
      return parsed;
    }
    return stripPlaceholderValues(parsed);
  }

  if (isPlainObject(parsed)) {
    // See: https://github.com/dahlia/optique/issues/407
    if (!containsPlaceholderValues(parsed)) {
      return parsed;
    }
    return stripPlaceholderValues(parsed);
  }

  // Only proxy non-plain objects when own-property placeholders are
  // detectable.  Clean class instances pass through unchanged to preserve
  // private-field getter access and object identity.  Non-plain objects
  // with placeholders hidden exclusively in private fields are a known
  // limitation at the top level.
  if (!containsPlaceholderValues(parsed)) {
    return parsed;
  }
  return createSanitizedNonPlainView(
    parsed,
    new WeakMap<object, unknown>(),
  );
}

function withPreparedParsedForContext<T>(
  context: SourceContext<unknown>,
  preparedParsed: unknown,
  run: (prepared: unknown) => T,
): T {
  return run(finalizeParsedForContext(context, preparedParsed));
}

/**
 * Helper types for parser generation
 */
interface HelpParsers {
  readonly helpCommand: Parser<"sync", readonly string[], unknown> | null;
  readonly helpOption: Parser<"sync", boolean, unknown> | null;
}

interface VersionParsers {
  readonly versionCommand:
    | Parser<"sync", Record<PropertyKey, never>, unknown>
    | null;
  readonly versionOption: Parser<"sync", boolean, unknown> | null;
}

/**
 * Creates help parsers based on the sub-config.
 */
function createHelpParser(
  commandConfig?: CommandSubConfig,
  optionConfig?: OptionSubConfig,
): HelpParsers {
  let helpCommand: HelpParsers["helpCommand"] = null;
  let helpOption: HelpParsers["helpOption"] = null;

  if (commandConfig) {
    const names = commandConfig.names ?? ["help"];
    const innerParser = multiple(
      argument(string({ metavar: "COMMAND" }), {
        description: message`Command name to show help for.`,
      }),
    );
    const commandParsers: Parser<
      "sync",
      readonly string[],
      unknown
    >[] = [];
    for (let i = 0; i < names.length; i++) {
      commandParsers.push(
        command(names[i], innerParser, {
          description: message`Show help information.`,
          hidden: i === 0 ? commandConfig.hidden : true,
        }),
      );
    }
    helpCommand = commandParsers.length === 1
      ? commandParsers[0]
      : longestMatch(...commandParsers);
  }

  if (optionConfig) {
    const names = optionConfig.names ?? ["--help"];
    helpOption = flag(...names, {
      description: message`Show help information.`,
      hidden: optionConfig.hidden,
    });
  }

  return { helpCommand, helpOption };
}

/**
 * Creates version parsers based on the sub-config.
 */
function createVersionParser(
  commandConfig?: CommandSubConfig,
  optionConfig?: OptionSubConfig,
): VersionParsers {
  let versionCommand: VersionParsers["versionCommand"] = null;
  let versionOption: VersionParsers["versionOption"] = null;

  if (commandConfig) {
    const names = commandConfig.names ?? ["version"];
    const innerParser = object({});
    const commandParsers: Parser<
      "sync",
      Record<PropertyKey, never>,
      unknown
    >[] = [];
    for (let i = 0; i < names.length; i++) {
      commandParsers.push(
        command(names[i], innerParser, {
          description: message`Show version information.`,
          hidden: i === 0 ? commandConfig.hidden : true,
        }),
      );
    }
    versionCommand = commandParsers.length === 1
      ? commandParsers[0]
      : longestMatch(...commandParsers);
  }

  if (optionConfig) {
    const names = optionConfig.names ?? ["--version"];
    versionOption = flag(...names, {
      description: message`Show version information.`,
      hidden: optionConfig.hidden,
    });
  }

  return { versionCommand, versionOption };
}

interface CompletionParsers {
  readonly completionCommand:
    | Parser<
      "sync",
      { shell: string | undefined; args: readonly string[] },
      unknown
    >
    | null;
  readonly completionOption:
    | Parser<
      "sync",
      { shell: string; args: readonly string[] },
      unknown
    >
    | null;
}

const metaResultBrand: unique symbol = Symbol("@optique/core/facade/meta");

interface MetaParseResult {
  readonly [metaResultBrand]: true;
  readonly help: boolean;
  readonly version: boolean;
  readonly completion?: boolean;
  readonly commands?: readonly string[] | { readonly length: number };
  readonly completionData?: {
    readonly shell: string | undefined;
    readonly args: readonly string[] | undefined;
  };
  readonly result?: unknown;
  readonly helpFlag?: boolean;
  readonly versionFlag?: boolean;
}

function isMetaParseResult(value: unknown): value is MetaParseResult {
  return typeof value === "object" && value != null && metaResultBrand in value;
}

/**
 * Sub-configuration for a meta command's command form.
 *
 * @since 1.0.0
 */
export interface CommandSubConfig {
  /**
   * Command names.  The first element is the display name shown in help
   * output; additional elements are hidden aliases that are accepted but
   * not shown.
   */
  readonly names?: readonly [string, ...string[]];

  /**
   * Group label for the command in help output.  When specified, the command
   * appears under a titled section with this name instead of alongside
   * user-defined commands.
   */
  readonly group?: string;

  /**
   * Granular visibility control.
   *
   * - `true`: Hidden from usage, documentation, and suggestions.
   * - `"usage"`: Hidden from usage lines only.
   * - `"doc"`: Hidden from documentation only.
   * - `"help"`: Hidden from usage and documentation only.
   */
  readonly hidden?: HiddenVisibility;
}

/**
 * Sub-configuration for a meta command's option form.
 *
 * @since 1.0.0
 */
export interface OptionSubConfig {
  /**
   * Option names (all shown in help, e.g., `"-h"`, `"--help"`).
   */
  readonly names?: readonly [OptionName, ...OptionName[]];

  /**
   * Group label for the option in help output.
   */
  readonly group?: string;

  /**
   * Granular visibility control.
   *
   * - `true`: Hidden from usage, documentation, and suggestions.
   * - `"usage"`: Hidden from usage lines only.
   * - `"doc"`: Hidden from documentation only.
   * - `"help"`: Hidden from usage and documentation only.
   */
  readonly hidden?: HiddenVisibility;
}

/**
 * Creates completion parsers based on the sub-config.
 */
function createCompletionParser(
  programName: string,
  availableShells: Record<string, ShellCompletion>,
  commandConfig?: CommandSubConfig,
  optionConfig?: OptionSubConfig,
): CompletionParsers {
  let completionCommand: CompletionParsers["completionCommand"] = null;
  let completionOption: CompletionParsers["completionOption"] = null;

  const shellList: MessageTerm[] = [];
  for (const shell in availableShells) {
    if (shellList.length > 0) shellList.push(text(", "));
    shellList.push(value(shell));
  }

  const completionInner = object({
    shell: optional(
      argument(string({ metavar: "SHELL" }), {
        description:
          message`Shell type (${shellList}). Generate completion script when used alone, or provide completions when followed by arguments.`,
      }),
    ),
    args: multiple(
      argument(string({ metavar: "ARG" }), {
        description:
          message`Command line arguments for completion suggestions (used by shell integration; you usually don't need to provide this).`,
      }),
    ),
  });

  if (commandConfig) {
    const names = commandConfig.names ?? ["completion"];
    const displayName = names[0];

    const completionCommandConfig = {
      brief: message`Generate shell completion script or provide completions.`,
      description:
        message`Generate shell completion script or provide completions.`,
      footer: message`Examples:${lineBreak()}  Bash:       ${
        commandLine(`eval "$(${programName} ${displayName} bash)"`)
      }${lineBreak()}  zsh:        ${
        commandLine(`eval "$(${programName} ${displayName} zsh)"`)
      }${lineBreak()}  fish:       ${
        commandLine(`eval "$(${programName} ${displayName} fish)"`)
      }${lineBreak()}  PowerShell: ${
        commandLine(
          `${programName} ${displayName} pwsh > ${programName}-completion.ps1; . ./${programName}-completion.ps1`,
        )
      }${lineBreak()}  Nushell:    ${
        commandLine(
          `${programName} ${displayName} nu | save ${programName}-completion.nu; source ./${programName}-completion.nu`,
        )
      }`,
    };

    const commandParsers: Parser<
      "sync",
      { shell: string | undefined; args: readonly string[] },
      unknown
    >[] = [];
    for (let i = 0; i < names.length; i++) {
      commandParsers.push(
        command(names[i], completionInner, {
          ...completionCommandConfig,
          hidden: i === 0 ? commandConfig.hidden : true,
        }),
      );
    }

    completionCommand = commandParsers.length === 1
      ? commandParsers[0]
      : longestMatch(...commandParsers);
  }

  if (optionConfig) {
    const names = optionConfig.names ?? ["--completion"];

    const completionOptions: Parser<"sync", string, unknown>[] = [];
    for (const name of names) {
      completionOptions.push(
        option(name, string({ metavar: "SHELL" }), {
          description: message`Generate shell completion script.`,
          hidden: optionConfig.hidden,
        }),
      );
    }

    const completionOptionParser = completionOptions.length === 1
      ? completionOptions[0]
      : longestMatch(...completionOptions);

    const argsParser = withDefault(
      multiple(
        argument(string({ metavar: "ARG" }), {
          description:
            message`Command line arguments for completion suggestions (used by shell integration; you usually don't need to provide this).`,
        }),
      ),
      [] as readonly string[],
    );

    completionOption = object({
      shell: completionOptionParser,
      args: argsParser,
    }) as Parser<
      "sync",
      { shell: string; args: readonly string[] },
      unknown
    >;
  }

  return { completionCommand, completionOption };
}

/**
 * Result classification types for cleaner control flow.
 */
type ParsedResult =
  | { readonly type: "success"; readonly value: unknown }
  | { readonly type: "help"; readonly commands: readonly string[] }
  | { readonly type: "version" }
  | {
    readonly type: "completion";
    readonly shell: string;
    readonly args: readonly string[];
  }
  | { readonly type: "error"; readonly error: Message };

/**
 * Systematically combines the original parser with help, version, and completion parsers.
 */
interface MetaCommandGroups {
  readonly helpCommandGroup?: string;
  readonly helpOptionGroup?: string;
  readonly versionCommandGroup?: string;
  readonly versionOptionGroup?: string;
  readonly completionCommandGroup?: string;
  readonly completionOptionGroup?: string;
}

function combineWithHelpVersion(
  originalParser: Parser<Mode, unknown, unknown>,
  helpParsers: HelpParsers,
  versionParsers: VersionParsers,
  completionParsers: CompletionParsers,
  groups?: MetaCommandGroups,
  helpOptionNames?: readonly string[],
  versionOptionNames?: readonly string[],
): Parser<Mode, unknown, unknown> {
  const parsers: Parser<Mode, unknown, unknown>[] = [];

  const effectiveHelpOptionNames = helpOptionNames ?? ["--help"];
  const effectiveVersionOptionNames = versionOptionNames ?? ["--version"];

  // Add options FIRST - they are more specific and should have priority

  // Add help option (standalone) - accepts any mix of options and arguments
  if (helpParsers.helpOption) {
    // Create a lenient help parser that accepts help flag anywhere
    // and ignores all other options/arguments
    const lenientHelpParser: Parser<"sync", unknown, unknown> = {
      $mode: "sync",
      $valueType: [],
      $stateType: [],
      priority: 200, // Very high priority
      usage: helpParsers.helpOption.usage,
      initialState: null,

      parse(context) {
        const { buffer, optionsTerminated } = context;

        // If options are terminated (after --), don't match
        if (optionsTerminated) {
          return {
            success: false,
            error: message`Options terminated.`,
            consumed: 0,
          };
        }

        let helpFound = false;
        let helpIndex = -1;

        // Look for help option names and version option names to implement
        // last-option-wins
        let versionIndex = -1;
        for (let i = 0; i < buffer.length; i++) {
          if (buffer[i] === "--") break; // Stop at options terminator
          if (effectiveHelpOptionNames.includes(buffer[i])) {
            helpFound = true;
            helpIndex = i;
          }
          if (effectiveVersionOptionNames.includes(buffer[i])) {
            versionIndex = i;
          }
        }

        // If both help and version options are present, but version comes
        // last, don't match
        if (helpFound && versionIndex > helpIndex) {
          return {
            success: false,
            error: message`Version option wins.`,
            consumed: 0,
          };
        }

        // Multiple help options is OK - just show help

        if (helpFound) {
          // Extract command names that appear before the help option
          const commands: string[] = [];
          for (let i = 0; i < helpIndex; i++) {
            const arg = buffer[i];
            // Include non-option arguments as commands (don't start with -)
            if (!arg.startsWith("-")) {
              commands.push(arg);
            }
          }

          // Consume all remaining arguments and return success
          return {
            success: true,
            next: {
              ...context,
              buffer: [],
              state: {
                [metaResultBrand]: true,
                help: true,
                version: false,
                completion: false,
                commands,
                helpFlag: true,
              },
            },
            consumed: buffer.slice(0),
          };
        }

        // Help option not found
        return {
          success: false,
          error: message`Flag ${
            optionName(effectiveHelpOptionNames[0])
          } not found.`,
          consumed: 0,
        };
      },

      complete(state) {
        return { success: true, value: state };
      },

      *suggest(_context, prefix) {
        for (const name of effectiveHelpOptionNames) {
          if (name.startsWith(prefix)) {
            yield { kind: "literal", text: name } as const;
          }
        }
      },

      getDocFragments(state) {
        return helpParsers.helpOption?.getDocFragments(state) ??
          { fragments: [] };
      },
    };

    const wrappedHelp = groups?.helpOptionGroup
      ? group(groups.helpOptionGroup, lenientHelpParser)
      : lenientHelpParser;
    parsers.push(wrappedHelp);
  }

  // Add version option (standalone) - accepts any mix of options and arguments
  if (versionParsers.versionOption) {
    // Create a lenient version parser that accepts version flag anywhere
    // and ignores all other options/arguments
    const lenientVersionParser: Parser<"sync", unknown, unknown> = {
      $mode: "sync",
      $valueType: [],
      $stateType: [],
      priority: 200, // Very high priority
      usage: versionParsers.versionOption.usage,
      initialState: null,

      parse(context) {
        const { buffer, optionsTerminated } = context;

        // If options are terminated (after --), don't match
        if (optionsTerminated) {
          return {
            success: false,
            error: message`Options terminated.`,
            consumed: 0,
          };
        }

        let versionFound = false;
        let versionIndex = -1;

        // Look for version option names and help option names to implement
        // last-option-wins
        let helpIndex = -1;
        for (let i = 0; i < buffer.length; i++) {
          if (buffer[i] === "--") break; // Stop at options terminator
          if (effectiveVersionOptionNames.includes(buffer[i])) {
            versionFound = true;
            versionIndex = i;
          }
          if (effectiveHelpOptionNames.includes(buffer[i])) {
            helpIndex = i;
          }
        }

        // If both version and help options are present, but help comes last,
        // don't match
        if (versionFound && helpIndex > versionIndex) {
          return {
            success: false,
            error: message`Help option wins.`,
            consumed: 0,
          };
        }

        // Multiple version options is OK - just show version

        if (versionFound) {
          // Consume all remaining arguments and return success
          return {
            success: true,
            next: {
              ...context,
              buffer: [],
              state: {
                [metaResultBrand]: true,
                help: false,
                version: true,
                completion: false,
                versionFlag: true,
              },
            },
            consumed: buffer.slice(0),
          };
        }

        // Version option not found
        return {
          success: false,
          error: message`Flag ${
            optionName(effectiveVersionOptionNames[0])
          } not found.`,
          consumed: 0,
        };
      },

      complete(state) {
        return { success: true, value: state };
      },

      *suggest(_context, prefix) {
        for (const name of effectiveVersionOptionNames) {
          if (name.startsWith(prefix)) {
            yield { kind: "literal", text: name } as const;
          }
        }
      },

      getDocFragments(state) {
        return versionParsers.versionOption?.getDocFragments(state) ??
          { fragments: [] };
      },
    };

    const wrappedVersion = groups?.versionOptionGroup
      ? group(groups.versionOptionGroup, lenientVersionParser)
      : lenientVersionParser;
    parsers.push(wrappedVersion);
  }

  // Add version command with optional help flag (enables version --help)
  if (versionParsers.versionCommand) {
    const versionParser = object({
      [metaResultBrand]: constant(true),
      help: constant(false),
      version: constant(true),
      completion: constant(false),
      result: versionParsers.versionCommand,
      helpFlag: helpParsers.helpOption
        ? optional(helpParsers.helpOption)
        : constant(false),
    });
    parsers.push(
      groups?.versionCommandGroup
        ? group(groups.versionCommandGroup, versionParser)
        : versionParser,
    );
  }

  // Add completion command with optional help flag (enables completion --help)
  if (completionParsers.completionCommand) {
    const completionParser = object({
      [metaResultBrand]: constant(true),
      help: constant(false),
      version: constant(false),
      completion: constant(true),
      completionData: completionParsers.completionCommand,
      helpFlag: helpParsers.helpOption
        ? optional(helpParsers.helpOption)
        : constant(false),
    });
    parsers.push(
      groups?.completionCommandGroup
        ? group(groups.completionCommandGroup, completionParser)
        : completionParser,
    );
  }

  // Add help command
  if (helpParsers.helpCommand) {
    const helpParser = object({
      [metaResultBrand]: constant(true),
      help: constant(true),
      version: constant(false),
      completion: constant(false),
      commands: helpParsers.helpCommand,
    });
    parsers.push(
      groups?.helpCommandGroup
        ? group(groups.helpCommandGroup, helpParser)
        : helpParser,
    );
  }

  // NOTE: completion *option* (e.g. `--completion SHELL`) is intentionally
  // NOT added here.  Unlike `--help` and `--version` which use lenient
  // scanners, the completion option requires a value argument and would
  // create a branch that fails when `--completion` is absent.  Completion
  // option requests are handled by the early-return code in `runParser()`
  // before the combined parser runs.  The completion option still appears
  // in help text via the help generation code in `handleResult()`.

  // Add main parser LAST - it's the most general
  parsers.push(object({
    [metaResultBrand]: constant(true),
    help: constant(false),
    version: constant(false),
    completion: constant(false),
    result: originalParser,
  }));

  // Track where the main parser is before building longestMatch
  const mainParserIndex = parsers.length - 1;

  if (parsers.length === 1) {
    return parsers[0];
  }

  let combined: Parser<Mode, unknown, unknown>;
  if (parsers.length === 2) {
    combined = longestMatch(parsers[0], parsers[1]);
  } else {
    // Use variadic longestMatch for all parsers
    // Our lenient help/version parsers will win because they consume all input
    combined = longestMatch(...parsers);
  }

  // Reorder the usage so that the main parser's usage appears before
  // meta-command (version/completion/help) usage.  The parsing order
  // remains unchanged — only the display order is affected.
  // See https://github.com/dahlia/optique/issues/107
  const topUsage = combined.usage[0];
  if (topUsage?.type === "exclusive" && mainParserIndex > 0) {
    const terms = [...topUsage.terms];
    const [mainTerm] = terms.splice(mainParserIndex, 1);
    // Insert main parser usage right after the lenient option parsers
    // (which occupy the first slots) but before meta commands.
    const lenientCount = (helpParsers.helpOption ? 1 : 0) +
      (versionParsers.versionOption ? 1 : 0);
    terms.splice(lenientCount, 0, mainTerm);
    combined = {
      ...combined,
      usage: [{ ...topUsage, terms }],
    };
  }

  return combined;
}

/**
 * Classifies the parsing result into a discriminated union for cleaner
 * handling.
 */
function classifyResult(
  result: Result<unknown>,
  args: readonly string[],
  helpOptionNames: readonly string[],
  helpCommandNames: readonly string[],
  versionOptionNames: readonly string[],
  versionCommandNames: readonly string[],
  completionCommandNames: readonly string[],
): ParsedResult {
  if (!result.success) {
    return { type: "error", error: result.error };
  }

  const value = result.value;
  if (isMetaParseResult(value)) {
    const parsedValue = value;

    const hasVersionOption = versionOptionNames.some((n) => args.includes(n));
    const hasVersionCommand = args.length > 0 &&
      versionCommandNames.includes(args[0]);
    const hasCompletionCommand = args.length > 0 &&
      completionCommandNames.includes(args[0]);
    const hasHelpOption = hasCompletionCommand
      // Completion command detected: only check args[1] for help
      ? helpOptionNames.length > 0 && args.length >= 2 &&
        helpOptionNames.includes(args[1])
      : helpOptionNames.some((n) => args.includes(n));
    const hasHelpCommand = args.length > 0 &&
      helpCommandNames.includes(args[0]);

    // Standard CLI behavior:
    // 1. `command --help` should show help for that command
    // 2. `--help` and `--version` together follow last-option-wins
    // 3. `--version` alone should show version
    // 4. `--help` alone should show help
    // 5. `completion --help` should show help for completion command

    // If we have both version command and help flag, help takes precedence
    // (show help for version)
    if (hasVersionCommand && hasHelpOption && parsedValue.helpFlag) {
      return { type: "help", commands: [args[0]] };
    }

    // If we have both completion command and help flag, help takes precedence
    // (show help for completion)
    if (hasCompletionCommand && hasHelpOption && parsedValue.helpFlag) {
      return { type: "help", commands: [args[0]] };
    }

    // If we have help command or help option, show help
    if (parsedValue.help && (hasHelpOption || hasHelpCommand)) {
      let commandContext: readonly string[] = [];

      if (Array.isArray(parsedValue.commands)) {
        commandContext = parsedValue.commands;
      } else if (
        typeof parsedValue.commands === "object" &&
        parsedValue.commands != null &&
        "length" in parsedValue.commands
      ) {
        commandContext = parsedValue.commands as readonly string[];
      }

      return { type: "help", commands: commandContext };
    }

    // If version is present and help is not requested, show version
    if (
      (hasVersionOption || hasVersionCommand) &&
      (parsedValue.version || parsedValue.versionFlag)
    ) {
      return { type: "version" };
    }

    // If completion is present and help is not requested, show completion
    if (parsedValue.completion && parsedValue.completionData) {
      return {
        type: "completion",
        shell: parsedValue.completionData.shell ?? "",
        args: parsedValue.completionData.args ?? [],
      };
    }

    // Neither help nor version nor completion requested, return actual result
    return {
      type: "success",
      value: "result" in parsedValue ? parsedValue.result : value,
    };
  }

  return { type: "success", value };
}

/**
 * Configuration options for the {@link run} function.
 *
 * @template THelp The return type when help is shown.
 * @template TError The return type when an error occurs.
 */
export interface RunOptions<THelp, TError> {
  /**
   * Enable colored output in help and error messages.
   *
   * @default `false`
   */
  readonly colors?: boolean;

  /**
   * Maximum width for output formatting. Text will be wrapped to fit within
   * this width.  If not specified, text will not be wrapped.
   */
  readonly maxWidth?: number;

  /**
   * Whether and how to display default values for options and arguments.
   *
   * - `boolean`: When `true`, displays defaults using format `[value]`
   * - `ShowDefaultOptions`: Custom formatting with configurable prefix and suffix
   *
   * Default values are automatically dimmed when `colors` is enabled.
   *
   * @default `false`
   * @since 0.4.0
   */
  readonly showDefault?: boolean | ShowDefaultOptions;

  /**
   * Whether and how to display valid choices for options and arguments
   * backed by enumerated value parsers (e.g., `choice()`).
   *
   * - `boolean`: When `true`, displays choices using format
   *   `(choices: a, b, c)`
   * - `ShowChoicesOptions`: Custom formatting with configurable prefix,
   *   suffix, label, and maximum number of items
   *
   * Choice values are automatically dimmed when `colors` is enabled.
   *
   * @default `false`
   * @since 0.10.0
   */
  readonly showChoices?: boolean | ShowChoicesOptions;

  /**
   * A custom comparator function to control the order of sections in the
   * help output.  When provided, it is used instead of the default smart
   * sort (command-only sections first, then mixed, then option/argument-only
   * sections).  Sections that compare equal (return `0`) preserve their
   * original relative order.
   *
   * @param a The first section to compare.
   * @param b The second section to compare.
   * @returns A negative number if `a` should appear before `b`, a positive
   *   number if `a` should appear after `b`, or `0` if they are equal.
   * @since 1.0.0
   */
  readonly sectionOrder?: (a: DocSection, b: DocSection) => number;

  /**
   * Help configuration.  When provided, enables help functionality.
   * At least one of `command` or `option` must be specified.
   *
   * @since 1.0.0
   */
  readonly help?:
    & {
      /** Callback invoked when help is requested. */
      readonly onShow?: (() => THelp) | ((exitCode: number) => THelp);
    }
    & (
      | {
        readonly command: true | CommandSubConfig;
        readonly option?: true | OptionSubConfig;
      }
      | {
        readonly option: true | OptionSubConfig;
        readonly command?: true | CommandSubConfig;
      }
    );

  /**
   * Version configuration.  When provided, enables version functionality.
   * At least one of `command` or `option` must be specified.
   *
   * @since 1.0.0
   */
  readonly version?:
    & {
      /** The version string to display when version is requested. */
      readonly value: string;
      /** Callback invoked when version is requested. */
      readonly onShow?: (() => THelp) | ((exitCode: number) => THelp);
    }
    & (
      | {
        readonly command: true | CommandSubConfig;
        readonly option?: true | OptionSubConfig;
      }
      | {
        readonly option: true | OptionSubConfig;
        readonly command?: true | CommandSubConfig;
      }
    );

  /**
   * Completion configuration.  When provided, enables shell completion.
   * At least one of `command` or `option` must be specified.
   *
   * @since 1.0.0
   */
  readonly completion?:
    & {
      /**
       * Available shell completions.  By default, includes `bash`, `fish`,
       * `nu`, `pwsh`, and `zsh`.
       *
       * @default `{ bash, fish, nu, pwsh, zsh }`
       */
      readonly shells?: Record<string, ShellCompletion>;
      /** Callback invoked when completion is requested. */
      readonly onShow?: (() => THelp) | ((exitCode: number) => THelp);
    }
    & (
      | {
        readonly command: true | CommandSubConfig;
        readonly option?: true | OptionSubConfig;
      }
      | {
        readonly option: true | OptionSubConfig;
        readonly command?: true | CommandSubConfig;
      }
    );

  /**
   * What to display above error messages:
   * - `"usage"`: Show usage information
   * - `"help"`: Show help text (if available)
   * - `"none"`: Show nothing above errors
   *
   * @default `"usage"`
   */
  readonly aboveError?: "usage" | "help" | "none";

  /**
   * Callback function invoked when parsing fails. The function can
   * optionally receive an exit code parameter.
   *
   * You usually want to pass `process.exit` on Node.js or Bun and `Deno.exit`
   * on Deno to this option.
   * @default Throws a {@link RunParserError}.
   */
  readonly onError?: (() => TError) | ((exitCode: number) => TError);

  /**
   * Function used to output error messages.  Assumes it prints the ending
   * newline.
   *
   * @default `console.error`
   */
  readonly stderr?: (text: string) => void;

  /**
   * Function used to output help and usage messages.  Assumes it prints
   * the ending newline.
   *
   * @default `console.log`
   */
  readonly stdout?: (text: string) => void;

  /**
   * Brief description shown at the top of help text.
   *
   * @since 0.4.0
   */
  readonly brief?: Message;

  /**
   * Detailed description shown after the usage line.
   *
   * @since 0.4.0
   */
  readonly description?: Message;

  /**
   * Usage examples for the program.
   *
   * @since 0.10.0
   */
  readonly examples?: Message;

  /**
   * Author information.
   *
   * @since 0.10.0
   */
  readonly author?: Message;

  /**
   * Information about where to report bugs.
   *
   * @since 0.10.0
   */
  readonly bugs?: Message;

  /**
   * Footer text shown at the bottom of help text.
   *
   * @since 0.4.0
   */
  readonly footer?: Message;
}

/**
 * Handles shell completion requests.
 * @since 0.6.0
 */
function handleCompletion<M extends Mode, THelp, TError>(
  completionArgs: readonly string[],
  programName: string,
  parser: Parser<M, unknown, unknown>,
  completionParser: Parser<"sync", unknown, unknown> | null,
  stdout: (text: string) => void,
  stderr: (text: string) => void,
  onCompletion: (() => THelp) | ((exitCode: number) => THelp),
  onError: (() => TError) | ((exitCode: number) => TError),
  availableShells: Record<string, ShellCompletion>,
  colors?: boolean,
  maxWidth?: number,
  completionCommandDisplayName?: string,
  completionOptionDisplayName?: string,
  isOptionMode?: boolean,
  sectionOrder?: (a: DocSection, b: DocSection) => number,
): ModeValue<M, THelp | TError> {
  const shellName = completionArgs[0] || "";
  const args = completionArgs.slice(1);

  const callOnError = (code: number): TError => onError(code);

  const callOnCompletion = (code: number): THelp => onCompletion(code);

  // Check if shell name is empty
  if (!shellName) {
    stderr("Error: Missing shell name for completion.\n");

    // Show help for completion command if parser is available
    if (completionParser) {
      const displayName = isOptionMode
        ? (completionOptionDisplayName ?? "--completion")
        : (completionCommandDisplayName ?? "completion");
      const doc = getDocPage(completionParser, [displayName]);
      if (doc) {
        stderr(
          formatDocPage(programName, doc, { colors, maxWidth, sectionOrder }),
        );
      }
    }

    return dispatchByMode(
      parser.$mode,
      () => {
        const result = callOnError(1);
        if (result instanceof Promise) {
          throw new RunParserError("Synchronous parser returned async result.");
        }
        return result;
      },
      // deno-lint-ignore require-await -- async wraps synchronous throws as rejections
      async () => callOnError(1),
    );
  }

  const shell = availableShells[shellName];

  if (!shell) {
    const available: MessageTerm[] = [];
    for (const name in availableShells) {
      if (available.length > 0) available.push(text(", "));
      available.push(value(name));
    }
    stderr(
      formatMessage(
        message`Error: Unsupported shell ${shellName}. Available shells: ${available}.`,
        { colors, quotes: !colors },
      ),
    );
    return dispatchByMode(
      parser.$mode,
      () => {
        const result = callOnError(1);
        if (result instanceof Promise) {
          throw new RunParserError("Synchronous parser returned async result.");
        }
        return result;
      },
      // deno-lint-ignore require-await -- async wraps synchronous throws as rejections
      async () => callOnError(1),
    );
  }

  if (args.length === 0) {
    // Generate completion script
    const completionArg = isOptionMode
      ? (completionOptionDisplayName ?? "--completion")
      : (completionCommandDisplayName ?? "completion");
    const script = shell.generateScript(programName, [
      completionArg,
      shellName,
    ]);
    stdout(script);

    return dispatchByMode(
      parser.$mode,
      () => {
        const result = callOnCompletion(0);
        if (result instanceof Promise) {
          throw new RunParserError("Synchronous parser returned async result.");
        }
        return result;
      },
      // deno-lint-ignore require-await -- async wraps synchronous throws as rejections
      async () => callOnCompletion(0),
    );
  }

  // Provide completion suggestions
  return dispatchByMode(
    parser.$mode,
    () => {
      const syncParser = parser as Parser<"sync", unknown, unknown>;
      const suggestions = suggest(syncParser, args as [string, ...string[]]);
      for (const chunk of shell.encodeSuggestions(suggestions)) {
        stdout(chunk);
      }
      const result = callOnCompletion(0);
      if (result instanceof Promise) {
        throw new RunParserError("Synchronous parser returned async result.");
      }
      return result;
    },
    async () => {
      const suggestions = await suggestAsync(
        parser as Parser<"async", unknown, unknown>,
        args as [string, ...string[]],
      );
      for (const chunk of shell.encodeSuggestions(suggestions)) {
        stdout(chunk);
      }
      return callOnCompletion(0);
    },
  );
}

/**
 * Validates the configured version value.
 *
 * @param value Runtime version value from configuration.
 * @returns The validated version string.
 * @throws {TypeError} If the value is not a string, is empty, or contains
 *         ASCII control characters.
 */
function validateVersionValue(value: unknown): string {
  if (typeof value !== "string") {
    const type = Array.isArray(value) ? "array" : typeof value;
    throw new TypeError(
      `Expected version value to be a string, but got ${type}.`,
    );
  }
  if (value === "") {
    throw new TypeError("Version value must not be empty.");
  }
  // deno-lint-ignore no-control-regex
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new TypeError(
      "Version value must not contain control characters.",
    );
  }
  return value;
}

/**
 * Escapes control characters in a string for display in error messages.
 *
 * @param value The string to escape.
 * @returns The escaped string with control characters replaced by escape
 *          sequences.
 */
function escapeControlChars(value: string): string {
  // deno-lint-ignore no-control-regex
  return value.replace(/[\x00-\x1f\x7f]/g, (ch) => {
    const code = ch.charCodeAt(0);
    switch (code) {
      case 0x09:
        return "\\t";
      case 0x0a:
        return "\\n";
      case 0x0d:
        return "\\r";
      default:
        return `\\x${code.toString(16).padStart(2, "0")}`;
    }
  });
}

/**
 * Validates meta option names at runtime.
 *
 * @param names The option names to validate.
 * @param label A human-readable label for error messages (e.g.,
 *              `"Help option"`).
 * @throws {TypeError} If the names array is empty, or any name is empty,
 *         lacks a valid prefix, or contains whitespace or control characters.
 */
function validateOptionNames(
  names: readonly string[],
  label: string,
): void {
  if (names.length === 0) {
    throw new TypeError(
      `Expected at least one ${label.toLowerCase()} name.`,
    );
  }
  for (const name of names) {
    if (name === "") {
      throw new TypeError(`${label} name must not be empty.`);
    }
    if (/^\s+$/.test(name)) {
      throw new TypeError(
        `${label} name must not be whitespace-only: ` +
          `"${escapeControlChars(name)}".`,
      );
    }
    // deno-lint-ignore no-control-regex
    if (/[\x00-\x1f\x7f]/.test(name)) {
      throw new TypeError(
        `${label} name must not contain control characters: ` +
          `"${escapeControlChars(name)}".`,
      );
    }
    if (/\s/.test(name)) {
      throw new TypeError(
        `${label} name must not contain whitespace: ` +
          `"${escapeControlChars(name)}".`,
      );
    }
    if (!/^(--|[-/+])/.test(name)) {
      throw new TypeError(
        `${label} name must start with "--", "-", "/", or "+": "${name}".`,
      );
    }
  }
}

/**
 * Validates meta command names at runtime.
 *
 * @param names The command names to validate.
 * @param label A human-readable label for error messages (e.g.,
 *              `"Help command"`).
 * @throws {TypeError} If the names array is empty, or any name is empty,
 *         whitespace-only, or contains whitespace or control characters.
 */
function validateCommandNames(
  names: readonly string[],
  label: string,
): void {
  if (names.length === 0) {
    throw new TypeError(
      `Expected at least one ${label.toLowerCase()} name.`,
    );
  }
  for (const name of names) {
    if (name === "") {
      throw new TypeError(`${label} name must not be empty.`);
    }
    if (/^\s+$/.test(name)) {
      throw new TypeError(
        `${label} name must not be whitespace-only: ` +
          `"${escapeControlChars(name)}".`,
      );
    }
    // deno-lint-ignore no-control-regex
    if (/[\x00-\x1f\x7f]/.test(name)) {
      throw new TypeError(
        `${label} name must not contain control characters: ` +
          `"${escapeControlChars(name)}".`,
      );
    }
    if (/\s/.test(name)) {
      throw new TypeError(
        `${label} name must not contain whitespace: ` +
          `"${escapeControlChars(name)}".`,
      );
    }
  }
}

/**
 * Runs a parser against command-line arguments with built-in help and error
 * handling.
 *
 * This function provides a complete CLI interface by automatically handling
 * help commands/options and displaying formatted error messages with usage
 * information when parsing fails. It augments the provided parser with help
 * functionality based on the configuration options.
 *
 * The function will:
 *
 * 1. Add help command/option support (unless disabled)
 * 2. Parse the provided arguments
 * 3. Display help if requested
 * 4. Show formatted error messages with usage/help info on parse failures
 * 5. Return the parsed result or invoke the appropriate callback
 *
 * @template TParser The parser type being run.
 * @template THelp Return type when help is shown (defaults to `void`).
 * @template TError Return type when an error occurs (defaults to `never`).
 * @param parser The parser to run against the command-line arguments.
 * @param programName Name of the program used in usage and help output.
 * @param args Command-line arguments to parse (typically from
 *             `process.argv.slice(2)` on Node.js or `Deno.args` on Deno).
 * @param options Configuration options for output formatting and callbacks.
 * @returns The parsed result value, or the return value of `onHelp`/`onError`
 *          callbacks.
 * @throws {TypeError} If `options.version.value` is not a non-empty string
 *          without ASCII control characters, or if any meta command/option
 *          name is empty, whitespace-only, contains whitespace or control
 *          characters, or (for option names) lacks a valid prefix (`--`,
 *          `-`, `/`, or `+`).
 * @throws {RunParserError} When parsing fails and no `onError` callback is
 *          provided.
 * @since 0.10.0 Added support for {@link Program} objects.
 */
// Overload: Program with sync parser
export function runParser<T, THelp = void, TError = never>(
  program: Program<"sync", T>,
  args: readonly string[],
  options?: RunOptions<THelp, TError>,
): T;

// Overload: Program with async parser
export function runParser<T, THelp = void, TError = never>(
  program: Program<"async", T>,
  args: readonly string[],
  options?: RunOptions<THelp, TError>,
): Promise<T>;

// Overload: sync parser returns sync result
export function runParser<
  TParser extends Parser<"sync", unknown, unknown>,
  THelp = void,
  TError = never,
>(
  parser: TParser,
  programName: string,
  args: readonly string[],
  options?: RunOptions<THelp, TError>,
): InferValue<TParser>;

// Overload: async parser returns Promise
export function runParser<
  TParser extends Parser<"async", unknown, unknown>,
  THelp = void,
  TError = never,
>(
  parser: TParser,
  programName: string,
  args: readonly string[],
  options?: RunOptions<THelp, TError>,
): Promise<InferValue<TParser>>;

// Overload: generic mode parser returns ModeValue (for internal use)
export function runParser<
  TParser extends Parser<Mode, unknown, unknown>,
  THelp = void,
  TError = never,
>(
  parser: TParser,
  programName: string,
  args: readonly string[],
  options?: RunOptions<THelp, TError>,
): ModeValue<InferMode<TParser>, InferValue<TParser>>;

// Implementation
export function runParser<
  TParser extends Parser<Mode, unknown, unknown>,
  THelp = void,
  TError = never,
>(
  parserOrProgram: TParser | Program<Mode, unknown>,
  programNameOrArgs: string | readonly string[],
  argsOrOptions?: readonly string[] | RunOptions<THelp, TError>,
  optionsParam?: RunOptions<THelp, TError>,
): ModeValue<InferMode<TParser>, InferValue<TParser>> {
  // Determine if we're using the new Program API or the old API
  const isProgram = typeof programNameOrArgs !== "string";

  let parser: TParser;
  let programName: string;
  let args: readonly string[];
  let options: RunOptions<THelp, TError>;

  if (isProgram) {
    // New API: runParser(program, args, options?)
    const program = parserOrProgram as Program<Mode, unknown>;
    parser = program.parser as TParser;
    programName = program.metadata.name;
    args = programNameOrArgs as readonly string[];
    options = (argsOrOptions as RunOptions<THelp, TError> | undefined) ?? {};

    // Merge program metadata into options
    options = {
      ...options,
      brief: options.brief ?? program.metadata.brief,
      description: options.description ?? program.metadata.description,
      examples: options.examples ?? program.metadata.examples,
      author: options.author ?? program.metadata.author,
      bugs: options.bugs ?? program.metadata.bugs,
      footer: options.footer ?? program.metadata.footer,
    };
  } else {
    // Old API: runParser(parser, programName, args, options?)
    parser = parserOrProgram as TParser;
    programName = programNameOrArgs as string;
    args = argsOrOptions as readonly string[];
    options = optionsParam ?? {};
  }

  // Extract all options first
  const {
    colors,
    maxWidth,
    showDefault,
    showChoices,
    sectionOrder,
    aboveError = "usage",
    onError = () => {
      throw new RunParserError("Failed to parse command line arguments.");
    },
    stderr = console.error,
    stdout = console.log,
    brief,
    description,
    examples,
    author,
    bugs,
    footer,
  } = options;

  // Normalize sub-configs: true -> {}, undefined stays undefined
  const norm = <T>(c: true | T | undefined): T | undefined =>
    c === true ? ({} as T) : c;

  // Extract help configuration
  const helpCommandConfig = norm<CommandSubConfig>(options.help?.command);
  const helpOptionConfig = norm<OptionSubConfig>(options.help?.option);
  const onHelp = options.help?.onShow ?? (() => ({} as THelp));

  // Extract version configuration
  const versionCommandConfig = norm<CommandSubConfig>(options.version?.command);
  const versionOptionConfig = norm<OptionSubConfig>(options.version?.option);
  const versionValue = options.version
    ? validateVersionValue(options.version.value)
    : undefined;
  const onVersion = options.version?.onShow ?? (() => ({} as THelp));

  // Extract completion configuration
  const completionCommandConfig = norm<CommandSubConfig>(
    options.completion?.command,
  );
  const completionOptionConfig = norm<OptionSubConfig>(
    options.completion?.option,
  );
  const onCompletion = options.completion?.onShow ?? (() => ({} as THelp));
  const onCompletionResult = (code: number): InferValue<TParser> =>
    onCompletion(code) as InferValue<TParser>;
  const onErrorResult = (code: number): InferValue<TParser> =>
    onError(code) as InferValue<TParser>;

  // Validate meta names eagerly
  if (helpOptionConfig?.names) {
    validateOptionNames(helpOptionConfig.names, "Help option");
  }
  if (helpCommandConfig?.names) {
    validateCommandNames(helpCommandConfig.names, "Help command");
  }
  if (versionOptionConfig?.names) {
    validateOptionNames(versionOptionConfig.names, "Version option");
  }
  if (versionCommandConfig?.names) {
    validateCommandNames(versionCommandConfig.names, "Version command");
  }
  if (completionOptionConfig?.names) {
    validateOptionNames(completionOptionConfig.names, "Completion option");
  }
  if (completionCommandConfig?.names) {
    validateCommandNames(completionCommandConfig.names, "Completion command");
  }

  // Resolved name arrays for matching
  const helpOptionNames: readonly string[] = helpOptionConfig?.names ??
    ["--help"];
  const helpCommandNames: readonly string[] = helpCommandConfig?.names ??
    ["help"];
  const versionOptionNames: readonly string[] = versionOptionConfig?.names ??
    ["--version"];
  const versionCommandNames: readonly string[] = versionCommandConfig?.names ??
    ["version"];
  const completionCommandNames: readonly string[] =
    completionCommandConfig?.names ?? ["completion"];
  const completionOptionNames: readonly string[] =
    completionOptionConfig?.names ?? ["--completion"];

  // Get available shells (defaults + user-provided)
  const defaultShells: Record<string, ShellCompletion> = {
    bash,
    fish,
    nu,
    pwsh,
    zsh,
  };
  const availableShells = options.completion?.shells
    ? { ...defaultShells, ...options.completion.shells }
    : defaultShells;

  // Create help and version parsers using the helper functions
  const helpParsers = options.help
    ? createHelpParser(helpCommandConfig, helpOptionConfig)
    : { helpCommand: null, helpOption: null };

  const versionParsers = options.version
    ? createVersionParser(versionCommandConfig, versionOptionConfig)
    : { versionCommand: null, versionOption: null };

  const completionParsers = options.completion
    ? createCompletionParser(
      programName,
      availableShells,
      completionCommandConfig,
      completionOptionConfig,
    )
    : { completionCommand: null, completionOption: null };

  // Early return for completion requests (avoids parser conflicts)
  // Exception: if a help option is present, let the parser handle it
  if (options.completion) {
    // Only consider args before the options terminator ("--") when checking
    // for help options; tokens after "--" are positional data.
    const helpTerminatorIndex = args.indexOf("--");
    const helpOptionArgs = helpTerminatorIndex >= 0
      ? args.slice(0, helpTerminatorIndex)
      : args;

    const hasHelpOption = helpOptionConfig
      ? (completionCommandConfig && completionCommandNames.includes(args[0]))
        // Completion command detected: only check args[1] for help
        ? args.length >= 2 && helpOptionNames.includes(args[1])
        // No completion command: check args before "--" only
        : helpOptionNames.some((n) => helpOptionArgs.includes(n))
      : false;

    // Handle completion command format: "completion <shell> [args...]"
    if (
      completionCommandConfig &&
      args.length >= 1 &&
      completionCommandNames.includes(args[0]) &&
      !hasHelpOption // Let parser handle "completion --help"
    ) {
      return handleCompletion<
        InferMode<TParser>,
        InferValue<TParser>,
        InferValue<TParser>
      >(
        args.slice(1),
        programName,
        parser,
        completionParsers.completionCommand,
        stdout,
        stderr,
        onCompletionResult,
        onErrorResult,
        availableShells,
        colors,
        maxWidth,
        completionCommandNames[0],
        completionOptionNames[0],
        false,
        sectionOrder,
      ) as ModeValue<InferMode<TParser>, InferValue<TParser>>;
    }

    // Handle completion option format: "--completion=<shell> [args...]"
    // The first --completion match is the meta option; everything after it
    // (including the shell name) is opaque completion payload and must not
    // be re-interpreted as another meta option.
    // Exception: if a help or version option/command appears *before* the
    // completion option, skip the early return and let the combined parser
    // handle precedence — but only with args truncated at the completion
    // option position so payload tokens stay opaque.
    //
    // This uses a naive token scan (matching raw argv strings against known
    // meta option names).  The combined parser's lenient help/version parsers
    // use the same naive approach: they scan the parse buffer for meta flag
    // names and match regardless of whether a token is actually an option
    // value.  So this early-return check is consistent with what the combined
    // parser would do — both treat any token matching a meta flag name as
    // that meta flag.
    // Check whether any help/version meta entry (option or command form)
    // appears in args before a given index.  Command-form entries are only
    // checked at args[0] since commands are always the first token.
    const hasMetaEntryBefore = (endIndex: number): boolean => {
      const argsBefore = args.slice(0, endIndex);
      if (
        helpOptionConfig &&
        helpOptionNames.some((n) => argsBefore.includes(n))
      ) return true;
      if (
        versionOptionConfig &&
        versionOptionNames.some((n) => argsBefore.includes(n))
      ) return true;
      if (endIndex > 0) {
        if (
          helpCommandConfig &&
          helpCommandNames.includes(args[0])
        ) return true;
        if (
          versionCommandConfig &&
          versionCommandNames.includes(args[0])
        ) return true;
      }
      return false;
    };

    let completionOptionIndex = -1;
    if (completionOptionConfig) {
      // Only scan args before the options terminator; reuse the index
      // already computed for the hasHelpOption check above.
      const loopBound = helpTerminatorIndex >= 0
        ? helpTerminatorIndex
        : args.length;
      for (let i = 0; i < loopBound; i++) {
        const arg = args[i];

        // Check for "--completion=<shell>" format
        const equalsMatch = completionOptionNames.find((n) =>
          arg.startsWith(n + "=")
        );
        if (equalsMatch) {
          if (hasMetaEntryBefore(i)) {
            completionOptionIndex = i;
            break; // Fall through with truncated args
          }
          const shell = arg.slice(equalsMatch.length + 1);
          const completionArgs = args.slice(i + 1);
          return handleCompletion<
            InferMode<TParser>,
            InferValue<TParser>,
            InferValue<TParser>
          >(
            [shell, ...completionArgs],
            programName,
            parser,
            completionParsers.completionOption,
            stdout,
            stderr,
            onCompletionResult,
            onErrorResult,
            availableShells,
            colors,
            maxWidth,
            completionCommandNames[0],
            completionOptionNames[0],
            true,
            sectionOrder,
          ) as ModeValue<InferMode<TParser>, InferValue<TParser>>;
        }

        // Check for "--completion <shell>" format (separate arg)
        const exactMatch = completionOptionNames.includes(arg);
        if (exactMatch) {
          if (hasMetaEntryBefore(i)) {
            completionOptionIndex = i;
            break; // Fall through with truncated args
          }
          const shell = i + 1 < args.length ? args[i + 1] : "";
          const completionArgs = i + 1 < args.length ? args.slice(i + 2) : [];
          return handleCompletion<
            InferMode<TParser>,
            InferValue<TParser>,
            InferValue<TParser>
          >(
            [shell, ...completionArgs],
            programName,
            parser,
            completionParsers.completionOption,
            stdout,
            stderr,
            onCompletionResult,
            onErrorResult,
            availableShells,
            colors,
            maxWidth,
            completionCommandNames[0],
            completionOptionNames[0],
            true,
            sectionOrder,
          ) as ModeValue<InferMode<TParser>, InferValue<TParser>>;
        }
      }
    }

    // When help/version precedes --completion, truncate args so the combined
    // parser and classifyResult only see tokens before the completion option.
    // This keeps completion payload opaque — e.g., --version after
    // --completion is not re-interpreted as a meta flag.
    if (completionOptionIndex >= 0) {
      args = args.slice(0, completionOptionIndex);
    }
  }

  // Build augmented parser with help, version, and completion functionality
  const augmentedParser = !options.help && !options.version &&
      !options.completion
    ? parser
    : combineWithHelpVersion(
      parser,
      helpParsers,
      versionParsers,
      completionParsers,
      {
        helpCommandGroup: helpCommandConfig?.group,
        helpOptionGroup: helpOptionConfig?.group,
        versionCommandGroup: versionCommandConfig?.group,
        versionOptionGroup: versionOptionConfig?.group,
        completionCommandGroup: completionCommandConfig?.group,
        completionOptionGroup: completionOptionConfig?.group,
      },
      helpOptionConfig ? [...helpOptionNames] : undefined,
      versionOptionConfig ? [...versionOptionNames] : undefined,
    );

  // Helper function to handle parsed result
  // Return type is InferValue<TParser> but callbacks may return THelp/TError
  // which are typically `never` (via process.exit) or a compatible type
  // For async parsers, this may return a Promise when help/error handling
  // requires awaiting getDocPage.
  const handleResult = (
    result: Result<unknown>,
  ): InferValue<TParser> | Promise<InferValue<TParser>> => {
    const classified = classifyResult(
      result,
      args,
      helpOptionConfig ? [...helpOptionNames] : [],
      helpCommandConfig ? [...helpCommandNames] : [],
      versionOptionConfig ? [...versionOptionNames] : [],
      versionCommandConfig ? [...versionCommandNames] : [],
      completionCommandConfig ? [...completionCommandNames] : [],
    );

    switch (classified.type) {
      case "success":
        return classified.value;

      case "version":
        stdout(versionValue!);
        return onVersion(0);

      case "completion":
        // This case should never be reached due to early return,
        // but keep it for type safety
        throw new RunParserError(
          "Completion should be handled by early return",
        );

      case "help": {
        // Handle help request - determine which parser to use for help
        // generation.  Include completion command in help even though it's
        // handled via early return.
        let helpGeneratorParser: Parser<Mode, unknown, unknown>;
        const helpAsCommand = helpCommandConfig != null;
        const versionAsCommand = versionCommandConfig != null;
        const completionAsCommand = completionCommandConfig != null;
        const helpAsOption = helpOptionConfig != null;
        const versionAsOption = versionOptionConfig != null;
        const completionAsOption = completionOptionConfig != null;

        // Check if user is requesting help for a specific meta-command
        const requestedCommand = classified.commands[0];
        if (
          requestedCommand != null &&
          completionCommandNames.includes(requestedCommand) &&
          completionAsCommand &&
          completionParsers.completionCommand
        ) {
          // User wants help for completion command specifically
          helpGeneratorParser = completionParsers.completionCommand;
        } else if (
          requestedCommand != null &&
          helpCommandNames.includes(requestedCommand) &&
          helpAsCommand &&
          helpParsers.helpCommand
        ) {
          // User wants help for help command specifically
          helpGeneratorParser = helpParsers.helpCommand;
        } else if (
          requestedCommand != null &&
          versionCommandNames.includes(requestedCommand) &&
          versionAsCommand &&
          versionParsers.versionCommand
        ) {
          // User wants help for version command specifically
          helpGeneratorParser = versionParsers.versionCommand;
        } else {
          // General help or help for user-defined commands
          // Collect all command parsers to include in help generation
          const commandParsers: Parser<Mode, unknown, unknown>[] = [parser];

          // Group meta-commands by their group label so that commands
          // sharing the same group name appear under a single section
          const groupedMeta: Record<
            string,
            Parser<Mode, unknown, unknown>[]
          > = {};
          const ungroupedMeta: Parser<Mode, unknown, unknown>[] = [];

          const addMeta = (
            p: Parser<Mode, unknown, unknown>,
            groupLabel?: string,
          ): void => {
            if (groupLabel) {
              (groupedMeta[groupLabel] ??= []).push(p);
            } else {
              ungroupedMeta.push(p);
            }
          };

          if (helpAsCommand && helpParsers.helpCommand) {
            addMeta(helpParsers.helpCommand, helpCommandConfig?.group);
          }
          if (versionAsCommand && versionParsers.versionCommand) {
            addMeta(versionParsers.versionCommand, versionCommandConfig?.group);
          }
          if (completionAsCommand && completionParsers.completionCommand) {
            addMeta(
              completionParsers.completionCommand,
              completionCommandConfig?.group,
            );
          }

          // Add ungrouped meta-commands directly
          commandParsers.push(...ungroupedMeta);

          // Add grouped meta-commands wrapped in group()
          for (const [label, parsers] of Object.entries(groupedMeta)) {
            if (parsers.length === 1) {
              commandParsers.push(group(label, parsers[0]));
            } else {
              // Combine multiple commands in the same group with or()
              commandParsers.push(
                group(
                  label,
                  longestMatch(...parsers),
                ),
              );
            }
          }

          // Include meta options so they appear in the help page usage line and
          // options list.  See https://github.com/dahlia/optique/issues/127
          // Group meta-options by their group label so that options sharing the
          // same group name appear under a single section
          const groupedMetaOptions: Record<
            string,
            Parser<Mode, unknown, unknown>[]
          > = {};
          const ungroupedMetaOptions: Parser<Mode, unknown, unknown>[] = [];

          const addMetaOption = (
            p: Parser<Mode, unknown, unknown>,
            groupLabel?: string,
          ): void => {
            if (groupLabel) {
              (groupedMetaOptions[groupLabel] ??= []).push(p);
            } else {
              ungroupedMetaOptions.push(p);
            }
          };

          if (helpAsOption && helpParsers.helpOption) {
            addMetaOption(helpParsers.helpOption, helpOptionConfig?.group);
          }

          if (versionAsOption && versionParsers.versionOption) {
            addMetaOption(
              versionParsers.versionOption,
              versionOptionConfig?.group,
            );
          }

          if (completionAsOption && completionParsers.completionOption) {
            addMetaOption(
              completionParsers.completionOption,
              completionOptionConfig?.group,
            );
          }

          // Add ungrouped meta-options directly
          commandParsers.push(...ungroupedMetaOptions);

          // Add grouped meta-options wrapped in group()
          for (
            const [label, optParsers] of Object.entries(groupedMetaOptions)
          ) {
            if (optParsers.length === 1) {
              commandParsers.push(group(label, optParsers[0]));
            } else {
              // Combine multiple options in the same group with longestMatch
              commandParsers.push(
                group(
                  label,
                  longestMatch(...optParsers),
                ),
              );
            }
          }

          // Use longestMatch to combine all parsers
          if (commandParsers.length === 1) {
            helpGeneratorParser = commandParsers[0];
          } else if (commandParsers.length === 2) {
            helpGeneratorParser = longestMatch(
              commandParsers[0],
              commandParsers[1],
            );
          } else {
            helpGeneratorParser = longestMatch(...commandParsers);
          }
        }

        // Helper function to report invalid commands before --help
        const reportInvalidHelpCommand = (
          validationError: Message,
        ): InferValue<TParser> => {
          stderr(
            `Usage: ${
              indentLines(
                formatUsage(programName, augmentedParser.usage, {
                  colors,
                  maxWidth: maxWidth == null ? undefined : maxWidth - 7,
                  expandCommands: true,
                }),
                7,
              )
            }`,
          );
          const errorMessage = formatMessage(validationError, {
            colors,
            quotes: !colors,
          });
          stderr(`Error: ${errorMessage}`);
          return onError(1);
        };

        // Helper function to display help and return
        const displayHelp = (doc: DocPage | undefined): InferValue<TParser> => {
          if (doc != null) {
            // Augment the doc page with provided options
            // But if showing help for a specific meta-command or subcommand,
            // don't override its description with run-level docs
            const isMetaCommandHelp = (requestedCommand != null &&
              completionCommandNames.includes(requestedCommand)) ||
              (requestedCommand != null &&
                helpCommandNames.includes(requestedCommand)) ||
              (requestedCommand != null &&
                versionCommandNames.includes(requestedCommand));
            const isSubcommandHelp = classified.commands.length > 0;
            // Check if this is top-level help (empty commands array means top-level)
            const isTopLevel = !isSubcommandHelp;
            // For root-level help, run-level docs (brief/description/footer)
            // take priority over parser-level docs, with parser-level as
            // fallback.
            // For subcommand/meta-command help, run-level brief and
            // description must NOT bleed into the subcommand's help page —
            // only the subcommand's own brief (shown at the top, before
            // Usage) and description (shown after Usage) are displayed.
            // run-level footer still applies as a fallback for subcommands
            // so that operators can add global footer notes across all help
            // pages.
            const shouldOverride = !isMetaCommandHelp && !isSubcommandHelp;
            const augmentedDoc = {
              ...doc,
              brief: shouldOverride ? (brief ?? doc.brief) : doc.brief,
              description: shouldOverride
                ? (description ?? doc.description)
                : doc.description,
              // Only show examples, author, and bugs for top-level help
              examples: isTopLevel && !isMetaCommandHelp
                ? (examples ?? doc.examples)
                : undefined,
              author: isTopLevel && !isMetaCommandHelp
                ? (author ?? doc.author)
                : undefined,
              bugs: isTopLevel && !isMetaCommandHelp
                ? (bugs ?? doc.bugs)
                : undefined,
              footer: shouldOverride
                ? (footer ?? doc.footer)
                : (doc.footer ?? footer),
            };
            stdout(formatDocPage(programName, augmentedDoc, {
              colors,
              maxWidth,
              showDefault,
              showChoices,
              sectionOrder,
            }));
          }
          return onHelp(0);
        };

        // Validate that the commands before --help are actually valid
        // by attempting to parse them step by step against the parser
        if (classified.commands.length > 0) {
          let validationContext: {
            buffer: readonly string[];
            optionsTerminated: boolean;
            state: unknown;
            usage: Usage;
          } = {
            buffer: [...classified.commands],
            optionsTerminated: false,
            state: helpGeneratorParser.initialState as unknown,
            usage: helpGeneratorParser.usage,
          };

          const processStep = (
            stepResult: ParserResult<unknown>,
          ): Message | null | "continue" => {
            if (!stepResult.success) {
              return stepResult.error;
            }
            if (stepResult.consumed.length < 1) {
              // Parser succeeded but didn't consume any input;
              // this means the remaining tokens aren't recognized
              return message`Unexpected option or subcommand: ${
                optionName(validationContext.buffer[0])
              }.`;
            }
            validationContext = {
              ...validationContext,
              buffer: stepResult.next.buffer,
              optionsTerminated: stepResult.next.optionsTerminated,
              state: stepResult.next.state,
              usage: stepResult.next.usage ?? validationContext.usage,
            };
            return validationContext.buffer.length > 0 ? "continue" : null;
          };

          // Iteratively validate each command token
          let validationResult: Message | null | "continue" = "continue";
          while (validationResult === "continue") {
            const stepResult = helpGeneratorParser.parse(validationContext);
            if (stepResult instanceof Promise) {
              // Async parser: chain remaining validation via Promise
              const asyncValidate = async (
                result: ParserResult<unknown>,
              ): Promise<InferValue<TParser>> => {
                let res = processStep(result);
                while (res === "continue") {
                  const next = helpGeneratorParser.parse(validationContext);
                  const resolved = next instanceof Promise ? await next : next;
                  res = processStep(resolved);
                }
                if (res != null) {
                  return reportInvalidHelpCommand(res);
                }
                // Commands are valid; proceed with help display
                const docOrPromise = getDocPage(
                  helpGeneratorParser,
                  classified.commands,
                );
                return docOrPromise instanceof Promise
                  ? docOrPromise.then(displayHelp)
                  : displayHelp(docOrPromise);
              };
              return stepResult.then(asyncValidate);
            }
            validationResult = processStep(stepResult);
          }
          if (validationResult != null) {
            return reportInvalidHelpCommand(validationResult);
          }
        }

        // Get doc page - may return Promise for async parsers
        const docOrPromise = getDocPage(
          helpGeneratorParser,
          classified.commands,
        );
        if (docOrPromise instanceof Promise) {
          return docOrPromise.then(displayHelp);
        }
        return displayHelp(docOrPromise);
      }

      case "error": {
        // Helper function to handle error display after doc is resolved
        const displayError = (
          doc: DocPage | undefined,
          currentAboveError: "help" | "usage" | "none",
        ): InferValue<TParser> => {
          let effectiveAboveError = currentAboveError;
          if (effectiveAboveError === "help") {
            if (doc == null) effectiveAboveError = "usage";
            else {
              // Augment the doc page with provided options
              const augmentedDoc = {
                ...doc,
                brief: brief ?? doc.brief,
                description: description ?? doc.description,
                examples: examples ?? doc.examples,
                author: author ?? doc.author,
                bugs: bugs ?? doc.bugs,
                footer: footer ?? doc.footer,
              };
              stderr(formatDocPage(programName, augmentedDoc, {
                colors,
                maxWidth,
                showDefault,
                showChoices,
              }));
            }
          }
          if (effectiveAboveError === "usage") {
            stderr(
              `Usage: ${
                indentLines(
                  formatUsage(programName, augmentedParser.usage, {
                    colors,
                    maxWidth: maxWidth == null ? undefined : maxWidth - 7,
                    expandCommands: true,
                  }),
                  7,
                )
              }`,
            );
          }
          // classified.error is now typed as Message
          const errorMessage = formatMessage(classified.error, {
            colors,
            quotes: !colors,
          });
          stderr(`Error: ${errorMessage}`);
          return onError(1);
        };

        // Error handling
        if (aboveError === "help") {
          const parserForDoc = args.length < 1 ? augmentedParser : parser;
          const docOrPromise = getDocPage(parserForDoc, args);
          if (docOrPromise instanceof Promise) {
            return docOrPromise.then((doc) => displayError(doc, aboveError));
          }
          return displayError(docOrPromise, aboveError);
        }
        return displayError(undefined, aboveError);
      }

      default:
        // This shouldn't happen but TypeScript doesn't know that
        throw new RunParserError("Unexpected parse result type");
    }
  };

  const parserMode = parser.$mode as InferMode<TParser>;
  return dispatchByMode(
    parserMode,
    () => {
      const result = parseSync(
        augmentedParser as Parser<"sync", unknown, unknown>,
        args,
      );
      const handled = handleResult(result);
      if (handled instanceof Promise) {
        throw new RunParserError("Synchronous parser returned async result.");
      }
      return handled;
    },
    async () => {
      const result = await parseAsync(augmentedParser, args);
      const handled = handleResult(result);
      return handled instanceof Promise ? await handled : handled;
    },
  ) as ModeValue<InferMode<TParser>, InferValue<TParser>>;
}

/**
 * Runs a synchronous command-line parser with the given options.
 *
 * This is a type-safe version of {@link runParser} that only accepts sync
 * parsers. Use this when you know your parser is sync-only to get direct
 * return values without Promise wrappers.
 *
 * @template TParser The sync parser type being executed.
 * @template THelp The return type of the onHelp callback.
 * @template TError The return type of the onError callback.
 * @param parser The synchronous command-line parser to execute.
 * @param programName The name of the program for help messages.
 * @param args The command-line arguments to parse.
 * @param options Configuration options for customizing behavior.
 * @returns The parsed result if successful.
 * @throws {TypeError} If an async parser is passed at runtime.  Use
 * {@link runParser} or {@link runParserAsync} for async parsers.
 * @since 0.9.0
 */
export function runParserSync<
  TParser extends Parser<"sync", unknown, unknown>,
  THelp = void,
  TError = never,
>(
  parser: TParser,
  programName: string,
  args: readonly string[],
  options?: RunOptions<THelp, TError>,
): InferValue<TParser> {
  if (parser.$mode !== "sync") {
    throw new TypeError(
      "Cannot use an async parser with runParserSync(). " +
        "Use runParser() or runParserAsync() instead.",
    );
  }
  return runParser(parser, programName, args, options);
}

/**
 * Runs any command-line parser asynchronously with the given options.
 *
 * This function accepts parsers of any mode (sync or async) and always
 * returns a Promise. Use this when working with parsers that may contain
 * async value parsers.
 *
 * @template TParser The parser type being executed.
 * @template THelp The return type of the onHelp callback.
 * @template TError The return type of the onError callback.
 * @param parser The command-line parser to execute.
 * @param programName The name of the program for help messages.
 * @param args The command-line arguments to parse.
 * @param options Configuration options for customizing behavior.
 * @returns A Promise of the parsed result if successful.
 * @since 0.9.0
 */
export function runParserAsync<
  TParser extends Parser<Mode, unknown, unknown>,
  THelp = void,
  TError = never,
>(
  parser: TParser,
  programName: string,
  args: readonly string[],
  options?: RunOptions<THelp, TError>,
): Promise<InferValue<TParser>> {
  const result = runParser(parser, programName, args, options);
  return Promise.resolve(result) as Promise<InferValue<TParser>>;
}

/**
 * An error class used to indicate that the command line arguments
 * could not be parsed successfully.
 */
export class RunParserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunParserError";
  }
}

function indentLines(text: string, indent: number): string {
  return text.split("\n").join("\n" + " ".repeat(indent));
}

/**
 * Checks if the arguments contain help, version, or completion requests
 * that should be handled immediately without context processing.
 *
 * This enables early exit optimization: when users request help, version,
 * or completion, we skip annotation collection and context processing
 * entirely, delegating directly to runParser().
 *
 * @param args Command-line arguments to check.
 * @param options Run options containing help/version/completion configuration.
 * @returns `true` if early exit should be performed, `false` otherwise.
 */
function needsEarlyExit<THelp, TError>(
  args: readonly string[],
  options: RunWithOptions<THelp, TError>,
): boolean {
  const norm = <T>(c: true | T | undefined): T | undefined =>
    c === true ? ({} as T) : c;

  // Only scan args before the options terminator ("--") for option-form
  // matches; tokens after "--" are positional data and must not be
  // interpreted as meta options.
  const terminatorIndex = args.indexOf("--");
  const optionArgs = terminatorIndex >= 0
    ? args.slice(0, terminatorIndex)
    : args;

  // Check help
  if (options.help) {
    const helpOptionConfig = norm<OptionSubConfig>(options.help.option);
    const helpCommandConfig = norm<CommandSubConfig>(options.help.command);
    const helpOptionNames: readonly string[] = helpOptionConfig?.names ??
      ["--help"];
    const helpCommandNames: readonly string[] = helpCommandConfig?.names ??
      ["help"];

    if (
      helpOptionConfig &&
      helpOptionNames.some((n) => optionArgs.includes(n))
    ) {
      return true;
    }
    if (helpCommandConfig && helpCommandNames.includes(args[0])) {
      return true;
    }
  }

  // Check version
  if (options.version) {
    const versionOptionConfig = norm<OptionSubConfig>(options.version.option);
    const versionCommandConfig = norm<CommandSubConfig>(
      options.version.command,
    );
    const versionOptionNames: readonly string[] = versionOptionConfig?.names ??
      ["--version"];
    const versionCommandNames: readonly string[] =
      versionCommandConfig?.names ?? ["version"];

    if (
      versionOptionConfig &&
      versionOptionNames.some((n) => optionArgs.includes(n))
    ) {
      return true;
    }
    if (versionCommandConfig && versionCommandNames.includes(args[0])) {
      return true;
    }
  }

  // Check completion
  if (options.completion) {
    const completionCommandConfig = norm<CommandSubConfig>(
      options.completion.command,
    );
    const completionOptionConfig = norm<OptionSubConfig>(
      options.completion.option,
    );
    const completionCommandNames: readonly string[] =
      completionCommandConfig?.names ?? ["completion"];
    const completionOptionNames: readonly string[] =
      completionOptionConfig?.names ?? ["--completion"];

    // Command mode
    if (completionCommandConfig && completionCommandNames.includes(args[0])) {
      return true;
    }

    // Option mode
    if (completionOptionConfig) {
      for (const arg of optionArgs) {
        for (const name of completionOptionNames) {
          if (arg === name || arg.startsWith(name + "=")) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

/**
 * Merges multiple annotation objects, with earlier contexts having priority.
 *
 * When the same symbol key exists in multiple annotations, the value from
 * the earlier context (lower index in the array) takes precedence.
 *
 * @param annotationsList Array of annotations to merge.
 * @returns Merged annotations object.
 */
function mergeAnnotations(
  annotationsList: readonly Annotations[],
): Annotations {
  const result: Record<symbol, unknown> = {};
  // Process in reverse order so earlier contexts override later ones
  for (let i = annotationsList.length - 1; i >= 0; i--) {
    const annotations = annotationsList[i];
    for (const key of Object.getOwnPropertySymbols(annotations)) {
      result[key] = annotations[key];
    }
  }
  return result;
}

/**
 * Collects phase 1 annotations from all contexts and determines whether
 * two-phase parsing is needed.
 *
 * @param contexts Source contexts to collect annotations from.
 * @param options Optional context-required options to pass to each context.
 * @returns Promise with merged annotations and dynamic-context hint.
 */
async function collectPhase1Annotations(
  contexts: readonly SourceContext<unknown>[],
  options?: unknown,
): Promise<
  {
    readonly annotations: Annotations;
    readonly annotationsList: readonly Annotations[];
    readonly hasDynamic: boolean;
  }
> {
  const annotationsList: Annotations[] = [];
  let hasDynamic = false;

  for (const context of contexts) {
    const result = context.getAnnotations(undefined, options);
    hasDynamic ||= needsTwoPhaseContext(context, result);
    const annotations = result instanceof Promise ? await result : result;
    const internalAnnotations = context.getInternalAnnotations?.(
      undefined,
      annotations,
    );
    annotationsList.push(
      internalAnnotations == null
        ? annotations
        : mergeAnnotations([annotations, internalAnnotations]),
    );
  }

  return {
    annotations: mergeAnnotations(annotationsList),
    annotationsList,
    hasDynamic,
  };
}

/**
 * Collects annotations from all contexts.
 *
 * @param contexts Source contexts to collect annotations from.
 * @param parsed Optional parsed result from a previous parse pass.
 * @param options Optional context-required options to pass to each context.
 * @returns Promise that resolves to merged annotations.
 */
async function collectAnnotations(
  contexts: readonly SourceContext<unknown>[],
  parsed?: unknown,
  options?: unknown,
): Promise<{
  readonly annotations: Annotations;
  readonly annotationsList: readonly Annotations[];
}> {
  const annotationsList: Annotations[] = [];
  const preparedParsed = prepareParsedForContexts(parsed);

  for (const context of contexts) {
    const mergedAnnotations = await withPreparedParsedForContext(
      context,
      preparedParsed,
      async (contextParsed) => {
        const result = context.getAnnotations(contextParsed, options);
        const annotations = result instanceof Promise ? await result : result;
        const internalAnnotations = context.getInternalAnnotations?.(
          contextParsed,
          annotations,
        );
        return internalAnnotations == null
          ? annotations
          : mergeAnnotations([annotations, internalAnnotations]);
      },
    );
    annotationsList.push(mergedAnnotations);
  }

  return {
    annotations: mergeAnnotations(annotationsList),
    annotationsList,
  };
}

/**
 * Collects phase 1 annotations from all contexts synchronously and determines
 * whether two-phase parsing is needed.
 *
 * @param contexts Source contexts to collect annotations from.
 * @param options Optional context-required options to pass to each context.
 * @returns Merged annotations with dynamic-context hint.
 * @throws Error if any context returns a Promise.
 */
function collectPhase1AnnotationsSync(
  contexts: readonly SourceContext<unknown>[],
  options?: unknown,
): {
  readonly annotations: Annotations;
  readonly annotationsList: readonly Annotations[];
  readonly hasDynamic: boolean;
} {
  const annotationsList: Annotations[] = [];
  let hasDynamic = false;

  for (const context of contexts) {
    const result = context.getAnnotations(undefined, options);
    if (result instanceof Promise) {
      throw new Error(
        `Context ${String(context.id)} returned a Promise in sync mode. ` +
          "Use runWith() or runWithAsync() for async contexts.",
      );
    }
    hasDynamic ||= needsTwoPhaseContext(context, result);
    const internalAnnotations = context.getInternalAnnotations?.(
      undefined,
      result,
    );
    annotationsList.push(
      internalAnnotations == null
        ? result
        : mergeAnnotations([result, internalAnnotations]),
    );
  }

  return {
    annotations: mergeAnnotations(annotationsList),
    annotationsList,
    hasDynamic,
  };
}

/**
 * Determines whether a context requires a second parse pass.
 *
 * Explicit `mode` declarations take precedence over legacy heuristics so
 * static contexts are not forced into two-phase parsing when they return
 * empty annotations or a Promise.
 */
function needsTwoPhaseContext(
  context: SourceContext<unknown>,
  result: Promise<Annotations> | Annotations,
): boolean {
  if (context.mode !== undefined) {
    return context.mode === "dynamic";
  }

  if (result instanceof Promise) {
    return true;
  }

  return Object.getOwnPropertySymbols(result).length === 0;
}

/**
 * Collects annotations from all contexts synchronously.
 *
 * @param contexts Source contexts to collect annotations from.
 * @param parsed Optional parsed result from a previous parse pass.
 * @param options Optional context-required options to pass to each context.
 * @returns Merged annotations.
 * @throws Error if any context returns a Promise.
 */
function collectAnnotationsSync(
  contexts: readonly SourceContext<unknown>[],
  parsed?: unknown,
  options?: unknown,
): {
  readonly annotations: Annotations;
  readonly annotationsList: readonly Annotations[];
} {
  const annotationsList: Annotations[] = [];
  const preparedParsed = prepareParsedForContexts(parsed);

  for (const context of contexts) {
    const mergedAnnotations = withPreparedParsedForContext(
      context,
      preparedParsed,
      (contextParsed) => {
        const result = context.getAnnotations(contextParsed, options);
        if (result instanceof Promise) {
          throw new Error(
            `Context ${String(context.id)} returned a Promise in sync mode. ` +
              "Use runWith() or runWithAsync() for async contexts.",
          );
        }
        const internalAnnotations = context.getInternalAnnotations?.(
          contextParsed,
          result,
        );
        return internalAnnotations == null
          ? result
          : mergeAnnotations([result, internalAnnotations]);
      },
    );
    annotationsList.push(mergedAnnotations);
  }

  return {
    annotations: mergeAnnotations(annotationsList),
    annotationsList,
  };
}

function mergeTwoPhaseAnnotations(
  phase1AnnotationsList: readonly Annotations[],
  phase2AnnotationsList: readonly Annotations[],
): Annotations {
  const mergedPerContext: Annotations[] = [];
  const length = Math.max(
    phase1AnnotationsList.length,
    phase2AnnotationsList.length,
  );
  for (let i = 0; i < length; i++) {
    mergedPerContext.push(
      mergeAnnotations([
        phase2AnnotationsList[i] ?? {},
        phase1AnnotationsList[i] ?? {},
      ]),
    );
  }
  return mergeAnnotations(mergedPerContext);
}

/**
 * Disposes all contexts that implement `AsyncDisposable` or `Disposable`.
 * Prefers `[Symbol.asyncDispose]` over `[Symbol.dispose]`.
 *
 * @param contexts Source contexts to dispose.
 */
async function disposeContexts(
  contexts: readonly SourceContext<unknown>[],
): Promise<void> {
  const errors: unknown[] = [];

  for (const context of contexts) {
    try {
      if (
        Symbol.asyncDispose in context &&
        typeof context[Symbol.asyncDispose] === "function"
      ) {
        await context[Symbol.asyncDispose]!();
      } else if (
        Symbol.dispose in context &&
        typeof context[Symbol.dispose] === "function"
      ) {
        context[Symbol.dispose]!();
      }
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      "Failed to dispose one or more source contexts.",
    );
  }
}

/**
 * Disposes all contexts that implement `Disposable` synchronously.
 * Falls back to `[Symbol.asyncDispose]` when it completes synchronously.
 *
 * @param contexts Source contexts to dispose.
 */
function disposeContextsSync(
  contexts: readonly SourceContext<unknown>[],
): void {
  const errors: unknown[] = [];

  for (const context of contexts) {
    try {
      if (
        Symbol.dispose in context &&
        typeof context[Symbol.dispose] === "function"
      ) {
        context[Symbol.dispose]!();
      } else if (
        Symbol.asyncDispose in context &&
        typeof context[Symbol.asyncDispose] === "function"
      ) {
        const result = context[Symbol.asyncDispose]!();
        if (
          typeof result === "object" &&
          result !== null &&
          "then" in result &&
          typeof result.then === "function"
        ) {
          throw new TypeError(
            `Context ${
              String(context.id)
            } returned a Promise from Symbol.asyncDispose in sync mode. ` +
              "Use runWith() or runWithAsync() for async disposal.",
          );
        }
      }
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      "Failed to dispose one or more source contexts.",
    );
  }
}

/**
 * Substitutes {@link ParserValuePlaceholder} with the actual parser value type.
 *
 * This type recursively traverses `T` and replaces any occurrence of
 * `ParserValuePlaceholder` with `TValue`. Used by `runWith()` to compute
 * the required options type based on the parser's result type.
 *
 * @template T The type to transform.
 * @template TValue The parser value type to substitute.
 * @since 0.10.0
 */
export type SubstituteParserValue<T, TValue> = T extends ParserValuePlaceholder
  ? TValue
  : T extends (...args: infer A) => infer R ? (
      ...args: { [K in keyof A]: SubstituteParserValue<A[K], TValue> }
    ) => SubstituteParserValue<R, TValue>
  : T extends object ? { [K in keyof T]: SubstituteParserValue<T[K], TValue> }
  : T;

/**
 * Converts a union type to an intersection type.
 * @internal
 */
type UnionToIntersection<U> = (
  U extends unknown ? (k: U) => void : never
) extends (k: infer I) => void ? I
  : never;

/**
 * Extracts and merges required options from an array of source contexts.
 *
 * For each context in the array, extracts its `TRequiredOptions` type parameter,
 * substitutes any `ParserValuePlaceholder` with `TValue`, and intersects all
 * the resulting option types.
 *
 * @template TContexts The tuple/array type of source contexts.
 * @template TValue The parser value type for placeholder substitution.
 * @since 0.10.0
 */
export type ExtractRequiredOptions<
  TContexts extends readonly SourceContext<unknown>[],
  TValue,
> = [
  TContexts[number] extends SourceContext<infer O> ? O extends void ? never
    : SubstituteParserValue<O, TValue>
    : never,
] extends [never] ? unknown
  : UnionToIntersection<
    TContexts[number] extends SourceContext<infer O> ? O extends void ? never
      : SubstituteParserValue<O, TValue>
      : never
  >;

/**
 * Options for runWith functions.
 * Extends RunOptions with additional context-related settings.
 *
 * @template THelp The return type when help is shown.
 * @template TError The return type when an error occurs.
 * @since 0.10.0
 */
export interface RunWithOptions<THelp, TError>
  extends RunOptions<THelp, TError> {
  /**
   * Command-line arguments to parse. If not provided, defaults to
   * `process.argv.slice(2)` on Node.js/Bun or `Deno.args` on Deno.
   */
  readonly args?: readonly string[];

  /**
   * Options to forward to source contexts.  When contexts declare
   * required options (via `$requiredOptions`), pass them here to
   * avoid name collisions with runner-level options such as `args`,
   * `help`, or `colors`.
   *
   * @since 1.0.0
   */
  readonly contextOptions?: Record<string, unknown>;
}

/**
 * When contexts require options, demands a `contextOptions` property
 * typed to those requirements.  When no context needs options
 * (`void`, `unknown`, or `{}`), resolves to `unknown` (intersection no-op).
 * When all context option keys are optional, `contextOptions` itself becomes
 * optional so callers are not forced to pass an empty wrapper.
 *
 * @template TContexts The tuple/array type of source contexts.
 * @template TValue The parser value type for placeholder substitution.
 * @since 1.0.0
 */
export type ContextOptionsParam<
  TContexts extends readonly SourceContext<unknown>[],
  TValue,
> = keyof ExtractRequiredOptions<TContexts, TValue> extends never ? unknown
  : Record<string, never> extends ExtractRequiredOptions<TContexts, TValue>
    ? { readonly contextOptions?: ExtractRequiredOptions<TContexts, TValue> }
  : { readonly contextOptions: ExtractRequiredOptions<TContexts, TValue> };

/**
 * Runs a parser with multiple source contexts.
 *
 * This function automatically handles static and dynamic contexts with proper
 * priority. Earlier contexts in the array override later ones.
 *
 * The function uses a smart two-phase approach:
 *
 * 1. *Phase 1*: Collect annotations from all contexts (static contexts return
 *    their data, dynamic contexts may return empty).
 * 2. *First parse*: Parse with Phase 1 annotations.
 * 3. *Phase 2*: Call `getAnnotations(parsed)` on all contexts with the first
 *    parse result.
 * 4. *Second parse*: Parse again with merged annotations from both phases.
 *
 * If all contexts are static (no dynamic contexts), the second parse is skipped
 * for optimization.
 *
 * @template TParser The parser type.
 * @template THelp Return type when help is shown.
 * @template TError Return type when an error occurs.
 * @param parser The parser to execute.
 * @param programName Name of the program for help/error output.
 * @param contexts Source contexts to use (priority: earlier overrides later).
 * @param options Run options including args, help, version, etc.
 * @returns Promise that resolves to the parsed result.
 * @since 0.10.0
 *
 * @example
 * ```typescript
 * import { runWith } from "@optique/core/facade";
 * import type { SourceContext } from "@optique/core/context";
 *
 * const envContext: SourceContext = {
 *   id: Symbol.for("@myapp/env"),
 *   getAnnotations() {
 *     return { [Symbol.for("@myapp/env")]: process.env };
 *   }
 * };
 *
 * const result = await runWith(
 *   parser,
 *   "myapp",
 *   [envContext],
 *   { args: process.argv.slice(2) }
 * );
 * ```
 */
export async function runWith<
  TParser extends Parser<Mode, unknown, unknown>,
  TContexts extends readonly SourceContext<unknown>[],
  THelp = void,
  TError = never,
>(
  parser: TParser,
  programName: string,
  contexts: TContexts,
  options:
    & RunWithOptions<THelp, TError>
    & ContextOptionsParam<TContexts, InferValue<TParser>>,
): Promise<InferValue<TParser>> {
  const args = options?.args ?? [];

  // Early exit: skip context processing for help/version/completion
  if (needsEarlyExit(args, options)) {
    if (parser.$mode === "async") {
      return runParser(parser, programName, args, options) as Promise<
        InferValue<TParser>
      >;
    }
    return Promise.resolve(
      runParser(parser, programName, args, options) as InferValue<TParser>,
    );
  }

  // If no contexts, just run the parser directly
  if (contexts.length === 0) {
    if (parser.$mode === "async") {
      return runParser(parser, programName, args, options) as Promise<
        InferValue<TParser>
      >;
    }
    return Promise.resolve(
      runParser(parser, programName, args, options) as InferValue<TParser>,
    );
  }

  try {
    // Phase 1: Collect initial annotations
    const ctxOptions = options?.contextOptions;
    const {
      annotations: phase1Annotations,
      annotationsList: phase1AnnotationsList,
      hasDynamic: needsTwoPhase,
    } = await collectPhase1Annotations(contexts, ctxOptions);

    if (!needsTwoPhase) {
      // All static contexts - single pass is sufficient
      // Inject annotations into the parser's initial state
      const augmentedParser = injectAnnotationsIntoParser(
        parser,
        phase1Annotations,
      );

      if (parser.$mode === "async") {
        return runParser(
          augmentedParser,
          programName,
          args,
          options,
        ) as Promise<InferValue<TParser>>;
      }
      return Promise.resolve(
        runParser(augmentedParser, programName, args, options) as InferValue<
          TParser
        >,
      );
    }

    // Two-phase parsing for dynamic contexts
    // First pass: parse with Phase 1 annotations to get initial result
    const augmentedParser1 = injectAnnotationsIntoParser(
      parser,
      phase1Annotations,
    );

    let firstPassResult: unknown;
    let firstPassFailed = false;
    try {
      if (parser.$mode === "async") {
        firstPassResult = await parseAsync(augmentedParser1, args);
      } else {
        firstPassResult = parseSync(
          augmentedParser1 as Parser<"sync", unknown, unknown>,
          args,
        );
      }

      // Extract value from result
      if (
        typeof firstPassResult === "object" && firstPassResult !== null &&
        "success" in firstPassResult
      ) {
        const result = firstPassResult as Result<unknown>;
        if (result.success) {
          firstPassResult = result.value;
        } else {
          firstPassFailed = true;
        }
      }
    } catch {
      firstPassFailed = true;
    }

    // First pass failed - run through runParser for proper error handling.
    // This is done outside the try-catch to prevent the catch block from
    // re-invoking runParser when it throws (which caused double error output).
    if (firstPassFailed) {
      const augmentedParser = injectAnnotationsIntoParser(
        parser,
        phase1Annotations,
      );
      if (parser.$mode === "async") {
        return runParser(
          augmentedParser,
          programName,
          args,
          options,
        ) as Promise<
          InferValue<TParser>
        >;
      }
      return Promise.resolve(
        runParser(augmentedParser, programName, args, options) as InferValue<
          TParser
        >,
      );
    }

    // Phase 2: Collect annotations with parsed result
    const { annotationsList: phase2AnnotationsList } = await collectAnnotations(
      contexts,
      firstPassResult,
      ctxOptions,
    );

    // Final parse with merged annotations
    const finalAnnotations = mergeTwoPhaseAnnotations(
      phase1AnnotationsList,
      phase2AnnotationsList,
    );
    const augmentedParser2 = injectAnnotationsIntoParser(
      parser,
      finalAnnotations,
    );

    if (parser.$mode === "async") {
      return runParser(augmentedParser2, programName, args, options) as Promise<
        InferValue<TParser>
      >;
    }
    return Promise.resolve(
      runParser(augmentedParser2, programName, args, options) as InferValue<
        TParser
      >,
    );
  } finally {
    await disposeContexts(contexts);
  }
}

/**
 * Runs a synchronous parser with multiple source contexts.
 *
 * This is the sync-only variant of {@link runWith}. All contexts must return
 * annotations synchronously (not Promises).
 *
 * @template TParser The sync parser type.
 * @template THelp Return type when help is shown.
 * @template TError Return type when an error occurs.
 * @param parser The synchronous parser to execute.
 * @param programName Name of the program for help/error output.
 * @param contexts Source contexts to use (priority: earlier overrides later).
 * @param options Run options including args, help, version, etc.
 * @returns The parsed result.
 * @throws {TypeError} If an async parser is passed at runtime.  Use
 * {@link runWith} or {@link runWithAsync} for async parsers.
 * @throws {Error} If any context returns a Promise or if a context's
 * `[Symbol.asyncDispose]` returns a Promise.
 * @since 0.10.0
 */
export function runWithSync<
  TParser extends Parser<"sync", unknown, unknown>,
  TContexts extends readonly SourceContext<unknown>[],
  THelp = void,
  TError = never,
>(
  parser: TParser,
  programName: string,
  contexts: TContexts,
  options:
    & RunWithOptions<THelp, TError>
    & ContextOptionsParam<TContexts, InferValue<TParser>>,
): InferValue<TParser> {
  if (parser.$mode !== "sync") {
    throw new TypeError(
      "Cannot use an async parser with runWithSync(). " +
        "Use runWith() or runWithAsync() instead.",
    );
  }

  const args = options?.args ?? [];

  // Early exit: skip context processing for help/version/completion
  if (needsEarlyExit(args, options)) {
    return runParser(parser, programName, args, options);
  }

  // If no contexts, just run the parser directly
  if (contexts.length === 0) {
    return runParser(parser, programName, args, options);
  }

  try {
    // Phase 1: Collect initial annotations
    const ctxOptions = options?.contextOptions;
    const {
      annotations: phase1Annotations,
      annotationsList: phase1AnnotationsList,
      hasDynamic: needsTwoPhase,
    } = collectPhase1AnnotationsSync(contexts, ctxOptions);

    if (!needsTwoPhase) {
      // All static contexts - single pass is sufficient
      const augmentedParser = injectAnnotationsIntoParser(
        parser,
        phase1Annotations,
      );
      return runParser(augmentedParser, programName, args, options);
    }

    // Two-phase parsing for dynamic contexts
    // First pass: parse with Phase 1 annotations
    const augmentedParser1 = injectAnnotationsIntoParser(
      parser,
      phase1Annotations,
    );

    let firstPassResult: unknown;
    try {
      const result = parseSync(augmentedParser1, args);
      if (result.success) {
        firstPassResult = result.value;
      } else {
        // First pass failed - run through runParser for proper error handling
        return runParser(augmentedParser1, programName, args, options);
      }
    } catch {
      // First pass threw - run through runParser for proper error handling
      return runParser(augmentedParser1, programName, args, options);
    }

    // Phase 2: Collect annotations with parsed result
    const { annotationsList: phase2AnnotationsList } = collectAnnotationsSync(
      contexts,
      firstPassResult,
      ctxOptions,
    );

    // Final parse with merged annotations
    const finalAnnotations = mergeTwoPhaseAnnotations(
      phase1AnnotationsList,
      phase2AnnotationsList,
    );
    const augmentedParser2 = injectAnnotationsIntoParser(
      parser,
      finalAnnotations,
    );

    return runParser(augmentedParser2, programName, args, options);
  } finally {
    disposeContextsSync(contexts);
  }
}

/**
 * Runs any parser asynchronously with multiple source contexts.
 *
 * This function accepts parsers of any mode (sync or async) and always
 * returns a Promise. Use this when working with async contexts or parsers.
 *
 * @template TParser The parser type.
 * @template THelp Return type when help is shown.
 * @template TError Return type when an error occurs.
 * @param parser The parser to execute.
 * @param programName Name of the program for help/error output.
 * @param contexts Source contexts to use (priority: earlier overrides later).
 * @param options Run options including args, help, version, etc.
 * @returns Promise that resolves to the parsed result.
 * @since 0.10.0
 */
export function runWithAsync<
  TParser extends Parser<Mode, unknown, unknown>,
  TContexts extends readonly SourceContext<unknown>[],
  THelp = void,
  TError = never,
>(
  parser: TParser,
  programName: string,
  contexts: TContexts,
  options:
    & RunWithOptions<THelp, TError>
    & ContextOptionsParam<TContexts, InferValue<TParser>>,
): Promise<InferValue<TParser>> {
  return runWith(parser, programName, contexts, options);
}

/**
 * Creates a new parser with annotations injected into its initial state.
 *
 * @param parser The original parser.
 * @param annotations Annotations to inject.
 * @returns A new parser with annotations in its initial state.
 */
function injectAnnotationsIntoParser<
  M extends Mode,
  TValue,
  TState,
>(
  parser: Parser<M, TValue, TState>,
  annotations: Annotations,
): Parser<M, TValue, TState> {
  // Create a new initial state with annotations
  const newInitialState = injectAnnotations(
    parser.initialState,
    annotations,
  ) as TState;

  // Return a parser with the new initial state
  return {
    ...parser,
    initialState: newInitialState,
  };
}
