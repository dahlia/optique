<!-- markdownlint-disable MD013 -->

Optique changelog
=================

Version 1.0.0
-------------

To be released.

### @optique/core

 -  Added generalized APIs to `SourceContext` and `Parser` interfaces so that
    packages like *@optique/config* and *@optique/inquirer* can integrate with
    core through public interfaces instead of `Symbol.for()` + `Reflect.get()`
    duck typing:

     -  `SourceContext.getInternalAnnotations()`: optional method for contexts
        to inject additional annotations during collection
     -  `SourceContext.finalizeParsed()`: optional method for contexts to
        transform parsed values before phase-2 annotation collection
     -  `Parser.shouldDeferCompletion()`: optional method that combinators
        (`optional()`, `withDefault()`, `group()`) forward from inner parsers
     -  `placeholder` symbol and `isPlaceholderValue()` in
        `@optique/core/context`: brand-based detection of placeholder values
        that should be stripped during two-phase parsing

    This removes core's hidden dependency on *@optique/config* and
    *@optique/inquirer* implementation details, enabling third-party
    alternative implementations.  [[#588]]

 -  Added `options` parameter to `SourceContext.getAnnotations()`.  Contexts
    now receive runtime options (e.g., `getConfigPath`, `load`) passed by
    the runner, enabling config contexts to load files without a separate
    `runWithConfig()` wrapper.  [[#110]]

 -  Renamed `SourceContext._requiredOptions` to `$requiredOptions` to follow
    the `$` prefix convention used by `ValueParser.$mode`, `Parser.$mode`,
    etc.  [[#110]]

 -  Added optional `Symbol.dispose` and `Symbol.asyncDispose` methods to
    `SourceContext`.  Contexts that hold resources (e.g., global registries)
    can now implement `Disposable` / `AsyncDisposable` for automatic cleanup.
    `runWith()` and `runWithSync()` call dispose on all contexts in a
    `finally` block.  [[#110]]

 -  Context-required options passed to `runWith()`, `runWithSync()`, and
    `runWithAsync()` must now be wrapped in a `contextOptions` property
    instead of being passed as top-level keys.  This prevents name collisions
    with runner options such as `args`, `help`, and `colors`.
    [[#240], [#241], [#575], [#581]]

 -  Added `fail<T>()` parser: always fails without consuming input, declared
    to produce a value of type `T`.  Its primary use is as the inner parser
    for `bindConfig(fail<T>(), { … })` when a value should come only from a
    config file and has no corresponding CLI flag.  [[#120]]

 -  Expanded `or()`'s fully inferred overloads from 10 to 15 parser
    arguments, so large alternative sets keep precise union inference without
    collapsing to `unknown` at 11+ arguments.  [[#142], [#143]]

 -  Added a type-level arity guard for `or()` calls with more than 15 parser
    arguments.  Instead of degrading to `unknown`, oversized calls now fail
    at compile time with an actionable message that recommends nesting `or()`
    calls.  [[#142], [#143]]

 -  Expanded `merge()`'s fully inferred overloads from 10 to 15 parser
    arguments, so larger merged parser sets keep precise object inference
    instead of degrading unexpectedly.  [[#144], [#145]]

 -  Expanded `concat()` and `longestMatch()` fully inferred overloads from 5
    to 15 parser arguments, so larger compositions keep precise tuple/union
    inference.  [[#144], [#145]]

 -  Added type-level arity guards for `merge()`, `concat()`, and
    `longestMatch()` calls above 15 parser arguments.  Oversized calls now fail
    at compile time with actionable messages that recommend nested
    composition.  [[#144], [#145]]

 -  Added runtime validation to `or()`, `longestMatch()`, `merge()`, and
    `concat()`: these combinators now throw `TypeError` at construction time
    when called with zero parser arguments.  Previously they relied only on
    compile-time arity guards, so JavaScript callers could create parsers with
    inconsistent behavior.  [[#403], [#696]]

 -  Added per-argument runtime validation to `or()`, `longestMatch()`,
    `merge()`, and `concat()`: each parser argument is now checked to be
    a valid `Parser` object at construction time, producing a clear
    `TypeError` instead of an internal crash when non-parser values are
    passed.  [[#406], [#700]]

 -  Added runtime validation of option names to `option()` and `flag()`:
    these functions now throw `TypeError` at construction time for empty
    strings, whitespace-only strings, strings with control characters,
    strings with embedded whitespace, the options terminator `"--"`, or
    strings without a valid prefix.  The `OptionName` type now enforces
    at least one character after the prefix at compile time in most cases,
    though `"--"` can still type-check and is rejected at runtime only.
    The `option()` and `flag()` overloads now require at least one option
    name argument.  [[#381], [#709]]

 -  Added the `@optique/core/mode-dispatch` subpath export so sibling
    packages can share internal sync/async dispatch helpers without
    duplicating them.  [[#157]]

 -  Changed `formatMessage()` to render double newlines (`\n\n`) in `text()`
    terms as double newlines in the output, instead of collapsing them to
    a single newline.  This makes paragraph breaks visually distinct from
    explicit `lineBreak()` terms, which render as a single newline.

 -  Changed the default section ordering in help output to use a smart
    type-aware sort: sections containing only commands appear first, followed
    by mixed sections, and then sections containing only options, flags, and
    arguments.  Untitled sections receive a slight priority boost so the
    main (untitled) section appears before titled sections of a similar
    classification.  Within each group, the original relative order is
    preserved.  Previously, untitled sections were sorted first regardless
    of content type.  This is a breaking change for help output layout.
    [[#115]]

 -  Added `sectionOrder` option to `DocPageFormatOptions` (in
    `formatDocPage()`), `RunOptions` (in `runParser()`), and `RunOptions`
    (in *@optique/run*'s `run()`).  When provided, the callback overrides
    the default smart sort to give full control over section ordering in
    help output.  [[#115]]

 -  Added display-oriented command usage customization:

     -  `UsageTerm` now supports an `ellipsis` term for concise usage
        placeholders.
     -  `command()` now accepts a `usageLine` option (`Usage` or callback)
        to customize the command's own help-page usage tail.

    This allows compact command help output such as
    `Usage: myapp config ...` without changing parse behavior or
    completion behavior.  [[#139]]

 -  Fixed `getDocPage()` preserving hidden terms from custom `DocFragments`
    instead of filtering them.  `buildDocPage()` now filters out entries whose
    terms are doc-hidden before assembling the final `DocPage`.  Additionally,
    `deduplicateDocEntries()` and `deduplicateDocFragments()` now skip hidden
    entries before deduplicating, so hidden terms cannot influence the ordering
    of visible entries.  Titled sections are now positioned at the first
    fragment containing visible entries, and titled sections with only hidden
    entries are omitted entirely.  [[#494], [#720]]

 -  Fixed `normalizeUsage()` reusing leaf `UsageTerm` objects by reference,
    which caused mutations of the normalized result to propagate back to the
    original usage tree.  [[#504], [#722]]

 -  Fixed `or()` and `longestMatch()` duplicating visible terms in
    documentation when branches share the same surface syntax.  [[#432], [#698]]

 -  Fixed sync completion paths in `runParser()`, `runParserSync()`, and
    `runWithSync()` silently returning `Promise` objects when a completion
    callback (`onShow` or `onError`) returns a `Promise`.  These paths now
    throw `RunParserError` consistently with the existing sync/async mismatch
    guard on help and parse-error paths.  [[#264], [#673]]

 -  Fixed `runParserSync()` and `runWithSync()` accepting async parser objects
    at runtime and returning `Promise`s instead of throwing.  These sync-only
    APIs now validate `parser.$mode` at runtime and throw `TypeError` if the
    parser is not synchronous.  [[#279], [#676]]

 -  Fixed `optional()` and `withDefault()` crashing when the parser's state
    is an annotation-injected object instead of `undefined`.  The state
    discrimination in `modifiers.ts` now uses `Array.isArray(state)` to
    distinguish the wrapped inner state `[TState]` from the initial state,
    instead of `typeof state === "undefined"`.  This allows annotation
    injection to work correctly for parsers with `undefined` initial states
    (e.g., `fail()` used with `bindConfig()`), which was broken by the
    earlier 0.10.6 fix that skipped injection entirely.  [[#131]]

 -  Fixed annotation injection for parsers with primitive initial states.
    Annotations are now preserved without corrupting the parser result value
    (e.g., `constant("ok")` remains `"ok"` instead of becoming an
    annotation object).  This affects annotation-enabled parse/run paths,
    including `runWith()` and `runWithSync()`.  [[#146]]

 -  Fixed `ip()` and `cidr()` with `version: "both"` allowing IPv4-mapped
    IPv6 addresses (e.g., `::ffff:192.168.0.1`) to bypass IPv4 restrictions
    such as `allowPrivate: false`.  The embedded IPv4 address is now checked
    against the configured IPv4 restrictions.  [[#339], [#721]]

 -  Fixed `hostname()` accepting dotted all-numeric strings (e.g.,
    `192.168.0.1`, `999.999.999.999`) that resemble IPv4 addresses rather
    than DNS hostnames.  This also affects `socketAddress()` with
    `host: { type: "hostname" }`.  [[#376], [#657]]

 -  Fixed `socketAddress()` with `host: { type: "both" }` allowing IP-shaped
    input to bypass IP restrictions (e.g., `allowPrivate: false`) by falling
    through to the hostname parser.  IP-shaped input is now routed exclusively
    to the IP parser based on lexical form, and specific restriction error
    messages (e.g., “192.168.1.1 is a private IP address.”) are propagated
    instead of the generic “invalid format” error.  [[#335], [#714]]

 -  Fixed `socketAddress()` with `host: { type: "both" }` accepting alternate
    IPv4 literal forms (hex octets like `0x7f.0x0.0x0.0x1`, single hex integers
    like `0x7f000001`, and octal integers like `017700000001`) as hostnames,
    bypassing IP restrictions.  These non-standard forms are now detected and
    rejected with a specific error message.  Detection is bounded to values
    that fit within the 32-bit IPv4 range, so hex-prefixed hostnames outside
    that range (e.g., `0x100000000`) remain valid.  Plain decimal host labels
    (e.g., `1234`, `2130706433`) also remain valid hostnames.  This also affects
    `socketAddress()` with `host: { type: "hostname" }`.  [[#715], [#717]]

 -  Fixed `hostname()` accepting case variants of `localhost` (e.g.,
    `LOCALHOST`, `LocalHost`) and wildcard-localhost forms (e.g.,
    `*.localhost`) when `allowLocalhost` is set to `false`.  DNS hostnames
    are case-insensitive, so all variants are now correctly rejected.
    This also affects `socketAddress()` with
    `host: { type: "hostname", hostname: { allowLocalhost: false } }`.
    [[#321], [#659]]

 -  Fixed `hostname()` accepting wildcard labels (`*`) outside the leftmost
    position (e.g., `foo.*.com`, `example.*`) and even when `allowWildcard`
    is `false` (e.g., bare `*`).  [[#355], [#661]]

 -  Fixed `hostname()` and `domain()` silently coercing invalid runtime
    option types.  Non-boolean values for `allowWildcard`,
    `allowUnderscore`, `allowLocalhost`, `allowSubdomains`, and `lowercase`
    are now rejected with a `TypeError` instead of being silently coerced
    by JavaScript truthiness.  [[#366], [#664]]

 -  Fixed `locale()` value parser's `format()` method dropping Unicode
    extension subtags (e.g., `en-US-u-ca-buddhist` was formatted as `en-US`).
    The method now uses `Intl.Locale.toString()` instead of `baseName` to
    preserve the full locale identifier.  [[#317], [#565]]

 -  Fixed `url()` parser's `suggest()` emitting `://` for non-hierarchical URL
    schemes like `mailto:` and `urn:`.  Suggestions now use `:` for
    non-hierarchical schemes and `://` only for special schemes (`http`,
    `https`, `ftp`, `ws`, `wss`, `file`) as defined by the WHATWG URL Standard.
    [[#342], [#678]]

 -  Fixed `hidden: true` commands and options leaking through “Did you
    mean?” typo suggestions.  Fully hidden terms are now excluded from
    typo-suggestion candidates.  [[#516], [#690]]

 -  Extended `hidden` visibility controls from `boolean` to
    `boolean | "usage" | "doc" | "help"` across primitive parsers:
    `option()`, `flag()`, `argument()`, `command()`, and `passThrough()`.
    `group()`, `object()`, and `merge()` now also support `hidden` with the
    same values, and wrapper/parser `hidden` values are combined as a union.
    `hidden: true` keeps the existing behavior (hidden from usage, docs,
    and suggestions).  `"usage"` and `"doc"` allow partial hiding, and
    `"help"` hides terms from usage and help listings while keeping them in
    shell completions and suggestion candidates.  [[#113], [#141]]

 -  Redesigned meta command configuration (help, version, completion) in
    `RunOptions` to use independent `command`/`option` sub-configs instead
    of `mode: "command" | "option" | "both"`.  Each meta command now accepts
    `{ command?: true | CommandSubConfig; option?: true | OptionSubConfig }`
    where at least one must be specified (enforced at the type level).
    `CommandSubConfig` supports `names` (first = display name, rest = hidden
    aliases via `longestMatch()`), `group`, and `hidden`.  `OptionSubConfig`
    supports `names` (all shown in help), `group`, and `hidden`.  This is
    a breaking change.  [[#130]]

 -  Removed `CompletionName`, `CompletionHelpVisibility`, `CompletionConfig`,
    `CompletionConfigBoth`, `CompletionConfigSingular`, and
    `CompletionConfigPlural` types.  Completion naming is now controlled via
    `CommandSubConfig.names` and `OptionSubConfig.names`.  [[#130]]

 -  Added support for equals-joined values on single-dash multi-character
    options in `option()` (e.g., `-seed=42`, `-max_len=1000`), in addition to
    existing `--option=value` and `/option:value` formats.  Single-character
    short options (e.g., `-v`) remain excluded from this joined form to avoid
    conflicts with short-option clustering.  `flag()` now also rejects this
    joined form consistently for Boolean flags.  [[#134] by Maxwell Koo]

 -  Added `SourceContextMode` type (`"static" | "dynamic"`) and optional
    `mode` field to `SourceContext`.  When set, `isStaticContext()` reads this
    field directly instead of calling `getAnnotations()`, preventing any side
    effects that `getAnnotations()` might have (such as mutating a global
    registry).  `createEnvContext()` sets `mode: "static"`;
    `createConfigContext()` sets `mode: "dynamic"`.  Existing custom contexts
    that omit the field are unaffected.

 -  Fixed `string({ pattern })` to avoid stateful `RegExp` behavior leaking
    across parse calls when the pattern uses `g` or `y` flags.  The parser now
    evaluates a fresh regular expression per parse, so repeated calls are
    deterministic and no longer mutate the caller's `pattern.lastIndex`.

 -  Fixed `string({ pattern })` to validate that `pattern` is a real `RegExp`
    at construction time.  Previously, a non-`RegExp` value reaching the
    parser through an untyped path would silently produce an always-matching
    regular expression; it now throws a `TypeError`.  [[#388], [#512]]

 -  Fixed option-value completion in `option()` so value-position suggestions
    no longer leak option-name candidates when the value prefix starts with
    `-` (for example, after `--mode --`).  This restores monotonic
    prefix-filtering behavior for value suggestions and aligns with parse
    context (option name consumed ⇒ value expected).

 -  Tightened program name validation for shell completion to require names
    to start with an alphanumeric character or underscore, rejecting names
    like `-` or `.`.  Previously, running from stdin (`node -`, `deno eval`)
    could infer `-` as the program name, producing broken completion
    scripts.  [[#235], [#568]]

 -  Fixed PowerShell file completion stripping directory prefixes from nested
    path suggestions.  Completing `src/` now returns `src/alpha.txt` instead
    of bare `alpha.txt`.  [[#253], [#632]]

 -  Fixed Nushell file completion returning an empty list for non-empty path
    prefixes.  Completing `src/` now correctly returns files under that
    directory.  [[#254], [#636]]

 -  Fixed zsh file completion passing literal `$ext_pattern` to `_files`
    instead of expanding the variable, so extension filtering (e.g.,
    `*.json`, `*.yaml`) now works correctly.  [[#256], [#639]]

 -  Fixed `encodeSuggestions()` for zsh, fish, Nushell, and PowerShell not
    escaping tabs and newlines in completion descriptions.  Descriptions
    containing `lineBreak()` terms or tab characters now have those
    characters replaced with spaces so the shell completion protocol is not
    corrupted.  [[#247], [#642]]

 -  Fixed shell completion for file-only `Suggestion.file` entries (`type: "file"`)
    excluding directories entirely, which prevented users from descending into
    subdirectories during path completion.  All five shell backends (Bash, zsh,
    fish, Nushell, PowerShell) now include directories as navigation targets
    alongside files.  [[#294], [#646]]

 -  Fixed `encodeSuggestions()` not stripping leading dots from
    `Suggestion.extensions`, which caused extension filtering to silently
    fail in all five shell backends.  Extensions like `[".ts", ".json"]`
    (as produced by `path()`) are now normalized to `["ts", "json"]` before
    encoding.  [[#647], [#650]]

 -  Fixed generated shell completion scripts not stripping leading dots from
    extension filters, so that dot-prefixed extensions (e.g., `.json`) in the
    transport protocol are handled correctly in Bash, fish, Nushell, and
    PowerShell.  Also fixed a `Split-Path` error in PowerShell that caused
    extension filtering to silently fail when the completion prefix was empty,
    and rewrote the PowerShell extension matching to use the `-in` operator
    instead of nested `ForEach-Object` pipelines.  [[#255], [#660]]

 -  Fixed shell completion scripts ignoring `Suggestion.file.pattern`, which
    caused file completions to enumerate the current directory instead of the
    pattern-specified path.  All five shell backends (Bash, zsh, fish, Nushell,
    PowerShell) now use the transported pattern as the glob base when it is
    non-empty.  [[#251], [#656]]

 -  Fixed `runParser()` missing-shell help for `--completion` rendering
    in command form (`myapp completion [SHELL] [ARG...]`) instead of
    option form.  When the user invokes `--completion` without a shell name,
    the error message now shows option-form usage and respects custom option
    names (e.g., `--completions`).  Previously, option-only mode showed no
    follow-up help at all, and both-mode showed only the command form.
    [[#275], [#668]]

 -  Clarified that the `--completion` early-return scanner intentionally uses
    first-match semantics: the first `--completion` is the meta option and
    all subsequent arguments (including tokens that look like `--completion`)
    are treated as opaque completion payload.  Added tests to document this
    behavior.  [[#364], [#670]]

 -  Fixed duplicate detection for equals-joined option syntax in `option()`
    when the value parser produces deferred or dependency-source state
    (for example, `DerivedValueParser` or `DependencySource`).  Repeated
    `--option=value` inputs now report a duplicate-option error instead of
    silently overwriting the earlier value.  [[#149]]

 -  Fixed `withDefault().getDocFragments()` crashing when a function-based
    default throws during help generation.  Help output now skips evaluating
    doc-only defaults when a custom `message` is provided, and otherwise
    omits the default display instead of throwing.  [[#150]]

 -  Fixed async `runParser()` help handling for `command --help` validation.
    In the async validation path, `displayHelp` was referenced before
    initialization, which could throw `ReferenceError` instead of showing help.
    `displayHelp` is now defined before async validation is invoked.

 -  Fixed `runParser()` duck-typing meta-command results based on field names
    like `help` and `version`.  Internal meta results are now branded with a
    private symbol, so custom parsers can safely return user data objects with
    overlapping field names without being misclassified.  [[#152]]

 -  Fixed `runParser()` swallowing legitimate callback exceptions from
    `onError`, `help.onShow`, `version.onShow`, and `completion.onShow`
    while trying to detect zero-argument handlers.  These callbacks now
    always receive the numeric exit code, and any real exception they throw
    is propagated unchanged.  [[#153]]

 -  Fixed source-context cleanup in `runWith()` and `runWithSync()`.
    Disposal now continues across all contexts even if an earlier dispose
    call throws, and `runWithSync()` no longer skips contexts that only
    implement `Symbol.asyncDispose` when that cleanup completes
    synchronously.  [[#154]]

 -  Fixed phase-two source-context inputs when later integrations need to
    inspect parsed values before the final parse completes.  During the
    second pass of `runWith()` / `runWithSync()`, deferred prompt placeholders
    are now scrubbed from parsed values before they reach later dynamic
    contexts, while preserving earlier-context precedence and stable
    parsed-value identity within the phase-two pass.  [[#177], [#490]]

 -  Fixed help output incorrectly interleaving meta items (`help`, `--help`,
    `--version`) with user-defined commands when using `group: "…"` to
    assign meta items to a named section that already exists in user-defined
    parsers.  Same-named sections from different parsers are now merged into
    a single section.  Additionally, when meta items are ungrouped and the
    user's commands are in a titled section, the meta items now appear
    *after* the user's section rather than before it.  [[#138]]

 -  Fixed `merge()` and `concat()` dropping dependency-aware suggestions when
    the dependency source and derived parser live in different sub-parsers.
    The `suggest()` methods now build a `DependencyRegistry` from the full
    composed state before delegating to child parsers, matching the behavior
    that `object()` already had.  [[#178], [#520]]

 -  Fixed `merge()` not pre-completing `bindEnv()`/`bindConfig()`-backed
    dependency sources for cross-parser resolution.  When a dependency source
    wrapped with `bindEnv()` or `bindConfig()` lived in one child parser of
    `merge()`, derived parsers in a different child parser could not see the
    resolved value.  The fix pre-completes dependency source fields from child
    parsers before resolving deferred states, and preserves annotations when
    extracting child parser states during completion.  [[#681], [#684]]

 -  Fixed dependency-aware completion ignoring `withDefault()` source values.
    When a dependency source was wrapped with `withDefault()` and no explicit
    CLI value was provided, `suggest()` returned an empty array instead of
    suggesting values based on the default.  [[#186], [#522]]

 -  Fixed `deriveSync()`, `deriveAsync()`, `deriveFromSync()`, and
    `deriveFromAsync()` so that errors thrown by the factory with default
    dependency values during the initial parse no longer prevent deferred
    resolution from succeeding with the actual dependency values.  Errors
    from the default branch are now caught and produce a preliminary failure
    result, which gets overridden when `parseWithDependency()` runs with
    the actual values.  `deriveAsync()` also no longer calls the factory
    during parser construction.  [[#225], [#524]]

 -  Fixed `derive()` and `deriveFrom()` eagerly executing default factories
    during parser construction to detect sync/async mode.  The factory is
    no longer called at construction time; instead, callers must provide
    a required `mode` field (`"sync"` or `"async"`) that declares the
    factory's return mode.  Callers with async factories should pass
    `mode: "async"` or use `deriveAsync()`/`deriveFromAsync()`.
    [[#223], [#527]]

 -  Fixed `derive()`, `deriveSync()`, `deriveAsync()`, `deriveFrom()`,
    `deriveFromSync()`, and `deriveFromAsync()` so that `format()` and
    `suggest()` no longer throw when the factory throws on the default
    dependency value.  `format()` now falls back to `String(value)` and
    `suggest()` yields empty suggestions instead of propagating the
    exception.  [[#224], [#531]]

 -  The `integer()` parser in number mode now rejects values outside the safe
    integer range (`Number.MIN_SAFE_INTEGER` to `Number.MAX_SAFE_INTEGER`).
    Previously, such values were silently rounded, losing precision.  A new
    `unsafeInteger` error callback in `IntegerOptionsNumber.errors` allows
    customizing the error message.  Use `type: "bigint"` for values beyond
    this range.  [[#248], [#525]]

 -  Fixed `float()` to reject numeric strings that overflow to `Infinity`
    (e.g., `1e309`) when `allowInfinity` is `false` (the default).
    Previously, only literal `"Infinity"` strings were rejected.
    [[#242], [#528]]

 -  Changed `choice()` to throw `TypeError` when `caseInsensitive` is `true`
    and multiple choices normalize to the same lowercase value (e.g., `"JSON"`
    and `"json"`).  Previously the first match won silently.  [[#310], [#533]]

 -  Changed `choice()` to throw `TypeError` when the choices array is empty.
    Previously `choice([])` created an unsatisfiable parser with a malformed
    error message.  [[#332], [#536]]

 -  Fixed `choice()` to deduplicate identical values in the choices list.
    Previously, duplicate entries appeared in suggestions, error messages,
    and help text.  [[#353], [#537]]

 -  Changed `choice()` to reject empty strings in the choices array.
    Previously, empty-string choices were silently accepted but produced
    invisible items in help text, error messages, and shell completions.
    [[#371], [#546]]

 -  Changed `choice()` to reject non-Boolean `caseInsensitive` option values
    at runtime.  Previously, truthy non-Boolean values like `"no"` silently
    enabled case-insensitive matching due to JavaScript truthiness coercion.
    [[#389], [#548]]

 -  Changed `port()` to reject non-Boolean `disallowWellKnown` option values
    at runtime.  Previously, truthy non-Boolean values like `"no"` silently
    enabled well-known port restrictions due to JavaScript truthiness coercion.
    [[#370], [#573]]

 -  Changed `portRange()` to reject non-Boolean `disallowWellKnown` and
    `allowSingle` option values at runtime.  Previously, truthy non-Boolean
    values like `"no"` silently enabled those behaviors due to JavaScript
    truthiness coercion.  [[#370], [#573]]

 -  Changed `portRange()` and `socketAddress()` to reject `separator` values
    that contain digit characters (including Unicode decimal digits such as
    Arabic-Indic `١`).  Digit-containing separators caused ambiguous splitting
    of numeric port input, silently reinterpreting single ports as ranges.
    [[#378], [#576]]

 -  Changed `portRange()` and `socketAddress()` to reject empty `separator`
    option values at construction time.  An empty separator makes the grammar
    ill-defined because the parser cannot determine token boundaries.
    [[#327], [#713]]

 -  Changed `choice()` to throw `TypeError` when `NaN` is included in the
    number choices array.  Previously, `NaN` was silently filtered out but
    still advertised in suggestions and help output, creating an unsatisfiable
    parser with contradictory diagnostics.  [[#363], [#553]]

 -  Fixed `choice()` to snapshot `caseInsensitive` at construction time,
    preventing post-construction option mutation from causing `parse()` and
    `suggest()` to diverge.  [[#508], [#554]]

 -  Fixed number `choice()` accepting hex (`0x10`), binary (`0b10`), octal
    (`0o10`), scientific notation (`2e0`), empty strings, and whitespace-only
    strings via JavaScript's `Number()` coercion.  Number choices now accept
    the canonical string representation and equivalent decimal spellings
    (e.g., `"8.0"` for `8`).  Alternate scientific-notation spellings are
    only accepted for values whose canonical form uses scientific notation
    (e.g., `"1e21"` for `1e+21`).  [[#315], [#523]]

 -  Fixed several value parsers (`choice()`, `string()`, `uuid()`,
    `email()`, `domain()`, `url()`) to snapshot caller-owned mutable
    configuration (arrays, error callbacks, and options) at construction
    time.  Previously, mutating the original config object or array after
    parser construction could silently change parse semantics, suggestions,
    and error messages.  `choice()` now also freezes its public `choices`
    property, and all snapshotted arrays (`allowedVersions`,
    `allowedDomains`, `allowedTLDs`, `allowedProtocols`) are frozen to
    prevent mutation through error callbacks.  [[#507], [#555]]

 -  Fixed `optional()`, `withDefault()`, and `group()` dropping the
    config-prompt deferral hook (`@optique/config/deferPromptUntilResolved`)
    from inner parsers.  These combinators now forward the hook so that
    `prompt(optional(bindConfig(...)))` and similar compositions correctly
    defer interactive prompts until phase-two config resolution.
    [[#385], [#535]]

 -  Fixed `shouldDeferCompletion` forwarding in `optional()` and
    `withDefault()`: the forwarded hook now unwraps the outer state
    (`[TState] | undefined`) to the inner `TState` before delegating to
    the inner parser's hook, and propagates annotations from the outer
    array to the inner element so annotation-based checks work correctly.
    [[#590], [#592]]

 -  Fixed `optional()` and `withDefault()` not propagating annotations from
    outer state into inner parser elements during `complete()`, which prevented
    `bindConfig()` from resolving config values through wrapper combinators.
    [[#385], [#535]]

 -  Fixed proxy-based sanitization of deferred prompt values breaking class
    methods that access private fields.  Methods on non-plain objects are now
    invoked with temporarily sanitized own properties on the original instance,
    allowing private field access to work correctly through the sanitized
    view.  [[#307], [#558]]

 -  Fixed `integer({ type: "bigint" })`, `port({ type: "bigint" })`, and
    `portRange({ type: "bigint" })` to reject empty strings, whitespace,
    signed-plus strings, and non-decimal literals (`0x`, `0b`, `0o`) that
    the `BigInt()` constructor would otherwise accept.
    [[#245], [#249], [#566], [#572]]

 -  Fixed `portRange()` and `socketAddress()` to derive the default `metavar`
    from the custom `separator` option (e.g., `portRange({ separator: ":" })`
    now defaults to `PORT:PORT` instead of always using `PORT-PORT`).
    [[#323], [#579]]

 -  `formatDocPage()` now throws `TypeError` when `programName` contains
    a CR or LF character, or when a section title is empty, whitespace-only,
    or contains a CR or LF character.  [[#429], [#479], [#580]]

 -  Fixed `formatDocPage()` ignoring small `maxWidth` values.  When `maxWidth`
    was smaller than the layout budget (`termIndent + termWidth + 2`), the
    formatter produced lines far wider than requested.  The term column now
    dynamically shrinks to share the available width with the description
    column.  [[#513], [#669]]

 -  Numeric parsers (`integer()`, `float()`, `port()`, `portRange()`,
    `cidr()`) now throw `RangeError` at construction time when given
    contradictory range configurations (e.g., `min > max`).  Previously,
    these parsers silently created unsatisfiable parsers that rejected every
    input.  [[#349], [#583]]

 -  Fixed `map()` applying transforms to deferred prompt placeholders during
    phase-one parsing.  `map(prompt(bindConfig(…)), fn)` no longer throws
    before config resolution runs.  [[#296], [#585]]

 -  Numeric parsers (`integer()`, `float()`, `port()`, `cidr()`) now throw
    `RangeError` at construction time when given non-finite bound values
    (e.g., `NaN`, `Infinity`, `-Infinity`).  Previously, these values
    silently disabled or distorted range validation.  [[#362], [#587]]

 -  Numeric parsers `integer()`, `port()`, and `portRange()` now reject
    invalid runtime `type` discriminant values at construction time.
    Previously, unsupported values silently fell back to number mode.
    [[#368], [#589]]

 -  Fixed `getDocPage()`/`getDocPageSync()`/`getDocPageAsync()` losing
    inner option/argument documentation when called on a top-level `command()`
    parser with no arguments.  [[#200], [#595]]

 -  Fixed `runParser()` crashing or showing help instead of handling completion
    when help-option names (e.g., `--help`) appear inside completion payloads.
    Help-option scanning now only checks the argument immediately after the
    completion command name, not the entire `args` array.  [[#300], [#599]]

 -  Fixed `email()` with `allowMultiple` splitting on commas inside quoted
    local parts and quoted display names.  [[#320], [#606]]

 -  Fixed `email({ allowedDomains: [] })` silently disabling domain filtering
    instead of rejecting all domains, making it consistent with
    `url({ allowedProtocols: [] })` and `domain({ allowedTLDs: [] })`.
    [[#341], [#610]]

 -  Fixed `email({ allowDisplayName: true })` accepting malformed inputs
    containing multiple angle-bracket groups or bare `<email>` wrappers
    without a display name.  [[#338], [#611]]

 -  Fixed `email({ lowercase: true })` lowercasing the entire address instead
    of only the domain part; the local part (including quoted local parts)
    is now preserved.  [[#352], [#614]]

 -  Fixed `email()` accepting IPv4-like dotted-quad domains (e.g.,
    `user@192.168.0.1`, `user@999.999.999.999`) as valid email addresses.
    Unbracketed IPv4-like dotted quads are now rejected.  [[#387], [#617]]

 -  Fixed `email()` accepting addresses that exceed RFC 5321 length limits
    (64-octet local-part maximum and 254-octet overall address maximum,
    measured in UTF-8).  [[#396], [#622]]

 -  Fixed `email({ allowMultiple: true })` round-trip: `format()` now joins
    addresses with `, ` (comma-space) instead of bare `,`, so quoted local
    parts containing commas (e.g., `"Doe, John"@example.com`) survive a
    `format()` → `parse()` cycle.  [[#354], [#626]]

 -  Fixed `email()` not validating malformed `allowedDomains` entries at
    construction time; entries like `"@example.com"`, `"example.com."`,
    `" example.com "`, or non-string values now throw a `TypeError`.
    [[#348], [#629]]

 -  Renamed `DomainOptions.allowedTLDs` to `allowedTlds` for naming
    consistency.  [[#345], [#638]]

 -  Fixed `domain()` not validating malformed `allowedTlds` entries at
    construction time; entries like `".com"`, `" com "`, or non-string
    values now throw a `TypeError`.  [[#345], [#638]]

 -  Fixed `domain()` accepting contradictory configuration such as
    `allowSubdomains: false` with `minLabels: 3`.  This combination creates
    an unsatisfiable parser, so it is now rejected at construction time with
    a `TypeError`.  [[#350], [#630]]

 -  Fixed `domain()` and `hostname()` accepting invalid structural
    constraints such as `minLabels: 0`, `maxLength: -1`, `minLabels: NaN`,
    or `maxLength: 1.5`.  These values are now rejected at construction
    time with a `RangeError`.  [[#351], [#631]]

 -  Fixed `domain()` accepting dotted numeric strings such as
    `192.168.0.1`, `999.999.999.999`, or `1.2` as valid domains.
    Inputs where every label is purely numeric are now rejected when
    two or more labels are present.  Single-label numeric domains
    (e.g., `"123"`) remain valid.  [[#375], [#634]]

 -  Fixed `domain()` not enforcing the 253-octet total domain length
    limit.  `domain()` now rejects domains exceeding 253 octets by
    default, matching `hostname()`'s existing behavior.  A `maxLength`
    option is available for custom limits, and a `tooLong` entry in
    `errors` allows customizing the error message.  [[#395], [#635]]

 -  Fixed `__FILE__` completion transport unable to represent `pattern` values
    containing `:` (e.g., Windows drive-letter prefixes like `C:/...`).
    Colons in the pattern field are now percent-encoded (`%3A`) so that the
    colon-delimited field boundaries stay intact.  Users must regenerate or
    re-source their shell completion script after upgrading for this fix to
    take effect.  [[#252], [#616]]

 -  Fixed Bash completion scripts using `compgen -z` which is unsupported on
    macOS's default GNU Bash 3.2.  File and directory completions now use
    glob-based iteration instead, matching the pattern already used for
    extension-filtered completions.  [[#250], [#608]]

 -  Fixed fish, Nushell, and PowerShell completion scripts ignoring
    `includeHidden: true` for file suggestions.  The shell-side `__FILE__`
    parsers now strip tab-delimited metadata before splitting by colon,
    so the `hidden` field is compared correctly.  Users must regenerate or
    re-source their shell completion script after upgrading for this fix to
    take effect.  [[#618], [#619]]

 -  Fixed fish, Nushell, and PowerShell completions not enumerating hidden
    (dot-prefixed) files even when `includeHidden` is `true`.  The parsed
    `hidden` flag only controlled the post-enumeration filter, but each
    shell's native file listing command excluded hidden files by default.
    Fish now additionally globs `$current.*`, Nushell uses `ls -a`, and
    PowerShell passes `-Force` to `Get-ChildItem` when hidden files are
    requested.  [[#623], [#624]]

 -  Fixed zsh completion not including hidden (dot-prefixed) files when
    `includeHidden` is `true`.  The zsh backend now temporarily enables
    `glob_dots` before calling `_files` or `_directories` when hidden
    files are requested.  [[#262], [#641]]

 -  Fixed shell completion transports emitting raw tabs and newlines in
    literal suggestion text, which corrupted shell-specific transport
    framing.  Control characters in `Suggestion.text` are now replaced
    with spaces, matching the existing description sanitization.
    [[#337], [#663]]

 -  `runParser()` now validates version values at runtime — empty strings,
    strings containing control characters, and non-string values are rejected
    with `TypeError`.  [[#439], [#645]]

 -  `runParser()` now validates meta command and option names (for help,
    version, and completion) eagerly at startup.  Empty arrays, empty
    strings, whitespace-only names, and names containing whitespace or
    control characters are rejected with `TypeError`.  Option names without
    a valid prefix (`--`, `-`, `/`, or `+`) are also rejected.
    [[#425], [#648]]

 -  Fixed `url()` not validating malformed `allowedProtocols` entries at
    construction time; entries like `"https"` (missing trailing colon),
    `"https://"`, or non-string values now throw a `TypeError`.
    [[#344], [#653]]

 -  `uuid()` now enforces strict [RFC 9562] validation by default: the
    version digit must be 1 through 8, and the variant nibble must follow
    the RFC 9562 layout (`10xx`).  The nil and max UUIDs are accepted as
    special standard values.  Use `uuid({ strict: false })` for the previous
    lenient behavior that accepts any hex digit in the version and variant
    positions.  [[#334], [#336], [#670], [#674]]

 -  `uuid()` now validates `allowedVersions` at construction time: each
    version must be an integer between 1 and 8, and duplicates are
    automatically removed.  [[#357], [#675]]

 -  Fixed `formatDocPage()` fixed-prefix sections exceeding `maxWidth`.
    The `Usage:` label, `Examples:`/`Author:`/`Bugs:` section labels, and
    `showDefault`/`showChoices` description prefixes were not covered by
    the minimum `maxWidth` validation, allowing the formatter to silently
    emit lines wider than requested.  `formatDocPage()` now raises the
    minimum `maxWidth` to account for all fixed-width labels actually in
    use.  [[#672], [#677]]

 -  Fixed `cidr()` discarding specific nested IPv4/IPv6 validation errors
    (e.g., private network, loopback, multicast restrictions) behind a
    generic “Expected a valid CIDR notation” error message.  Added
    `privateNotAllowed`, `loopbackNotAllowed`, `linkLocalNotAllowed`,
    `multicastNotAllowed`, `broadcastNotAllowed`, `zeroNotAllowed`, and
    `uniqueLocalNotAllowed` error hooks to `CidrOptions.errors` so callers
    can customize these diagnostics.  [[#333], [#679]]

 -  `url()`, `domain()`, and `email()` now reject empty allow-lists
    (`allowedProtocols: []`, `allowedTlds: []`, `allowedDomains: []`) at
    construction time with a `TypeError`, instead of silently creating
    unsatisfiable parsers with malformed error messages.  Their default error
    messages for disallowed values now use `valueSet()` with
    `locale: "en-US"` for consistent list formatting (each item styled
    individually), replacing the previous `.join(", ")` approach.
    [[#340], [#682]]

 -  Changed `macAddress()` to accept and normalize single-digit octets
    (e.g., `0:1:2:3:4:5` becomes `00:01:02:03:04:05`) in colon-separated
    and hyphen-separated formats.  All octets are now zero-padded to two
    hexadecimal digits, ensuring canonical MAC-48 output and correct
    round-tripping with `outputSeparator`.  [[#319], [#330], [#683], [#723]]

 -  Fixed `macAddress()` to validate `separator`, `outputSeparator`, and `case`
    options at construction time.  Unsupported runtime values now throw
    `TypeError` instead of silently falling through to arbitrary behavior.
    [[#347], [#685]]

 -  Fixed `--completion` option (and `--help`/`--version`) being recognized
    after the `--` options terminator in `runParser()`, `runWith()`, and
    `runWithSync()`.  Tokens after `--` are now correctly treated as positional
    data and no longer trigger meta-option early-exit paths.  [[#228], [#686]]

 -  Fixed `--completion` option bypassing `--help`/`--version` precedence in
    `runParser()`.  When `--help` or `--version` appears *before* the
    `--completion` option (e.g., `--help --completion bash`), the help or
    version path now correctly takes precedence.  Tokens *after* `--completion`
    remain opaque completion payload and are not re-interpreted as meta flags.
    [[#229], [#689]]

 -  Fixed `formatDocPage()` rendering blank or malformed rows for degenerate
    entry terms (e.g., option with empty names, empty command/argument/literal,
    empty exclusive branches) and hidden entries in custom `DocPage` input.
    Such entries are now silently skipped.  [[#488], [#687]]

 -  Fixed `formatDocPage()` using the wrong hidden visibility check: it applied
    usage-level filtering (`isUsageHidden()`) instead of doc-level filtering
    (`isDocHidden()`).  As a result, `hidden: "doc"` terms leaked into doc
    output, while `hidden: "usage"` terms were incorrectly omitted.
    [[#488], [#687]]

 -  Added `context` option to `UsageTermFormatOptions` for `formatUsageTerm()`.
    Set `context: "doc"` to apply doc-level hidden filtering instead of the
    default usage-level filtering.  [[#488], [#687]]

 -  Fixed `formatDocPage()` rendering empty `choices` and `default` messages
    as malformed suffixes (e.g., `(choices: )`, `[]`) when the `Message`
    array was empty.  Empty arrays are now treated as absent.  [[#469], [#692]]

 -  Fixed `formatDocPage()` producing malformed output `(choices: , ...)`
    when `showChoices.maxItems` is `0`.  `maxItems` must now be at least `1`;
    values below `1` throw a `RangeError`.  [[#471], [#694]]

 -  Fixed `deduplicateSuggestions()` silently dropping `includeHidden: true`
    when merging file suggestions that differ only in `includeHidden`.
    Duplicates are now merged with `includeHidden: true` preferred, since
    it is a superset of the non-hidden variant.  [[#518], [#693]]

 -  Fixed `deduplicateSuggestions()` treating file suggestions with the same
    `extensions` in different order as distinct.  Extensions are now compared
    as a set, so `[".json", ".yaml"]` and `[".yaml", ".json"]` correctly
    deduplicate to one suggestion.  [[#519], [#695]]

 -  Fixed `getDocPage()` exposing parser-owned usage terms and doc fragments
    by reference.  Mutating the returned `DocPage` or the `defaultUsageLine`
    argument in a command's `usageLine` callback no longer corrupts the
    parser definition.  [[#500], [#697]]

 -  Added deep-clone utilities for parser structures:

     -  `cloneUsageTerm()` and `cloneUsage()` in `@optique/core/usage`
     -  `cloneDocEntry()` in `@optique/core/doc`
     -  `cloneMessageTerm()` and `cloneMessage()` in `@optique/core/message`

    These are used internally by `getDocPage()` to isolate returned
    documentation pages from parser-owned state, and are also available
    as public APIs for consumers who need to deep-copy these structures.
    [[#500], [#697]]

 -  Fixed `normalizeUsage()` to strip degenerate usage terms instead of
    preserving them unchanged.  Empty-named options, empty-named commands,
    empty-metavar arguments, and container terms (`optional`, `multiple`,
    `exclusive`) whose terms array is empty after recursive normalization
    are now removed.  Exclusive branches representing valid zero-token
    alternatives and empty-value literals are preserved; branches that
    become empty because all their content was malformed are removed.
    [[#485], [#716]]

 -  Fixed `message()` tagged template reusing interpolated `MessageTerm`
    objects and `Message` arrays by reference, allowing mutation of the
    returned message to corrupt the original interpolated values.
    Interpolated terms are now deep-cloned via `cloneMessageTerm()`.
    [[#505], [#718]]

 -  Fixed `optionNames()`, `values()`, and `url()` message term constructors
    storing caller-owned arrays and `URL` objects by reference, allowing
    later caller-side mutations to corrupt already-created terms.
    These constructors now defensively copy their inputs.  [[#506], [#719]]

[RFC 9562]: https://www.rfc-editor.org/rfc/rfc9562
[#110]: https://github.com/dahlia/optique/issues/110
[#113]: https://github.com/dahlia/optique/issues/113
[#115]: https://github.com/dahlia/optique/issues/115
[#120]: https://github.com/dahlia/optique/issues/120
[#130]: https://github.com/dahlia/optique/issues/130
[#131]: https://github.com/dahlia/optique/issues/131
[#134]: https://github.com/dahlia/optique/pull/134
[#138]: https://github.com/dahlia/optique/issues/138
[#139]: https://github.com/dahlia/optique/issues/139
[#141]: https://github.com/dahlia/optique/issues/141
[#142]: https://github.com/dahlia/optique/issues/142
[#143]: https://github.com/dahlia/optique/pull/143
[#144]: https://github.com/dahlia/optique/issues/144
[#145]: https://github.com/dahlia/optique/pull/145
[#146]: https://github.com/dahlia/optique/pull/146
[#149]: https://github.com/dahlia/optique/issues/149
[#150]: https://github.com/dahlia/optique/issues/150
[#152]: https://github.com/dahlia/optique/issues/152
[#153]: https://github.com/dahlia/optique/issues/153
[#154]: https://github.com/dahlia/optique/issues/154
[#157]: https://github.com/dahlia/optique/issues/157
[#177]: https://github.com/dahlia/optique/issues/177
[#178]: https://github.com/dahlia/optique/issues/178
[#186]: https://github.com/dahlia/optique/issues/186
[#200]: https://github.com/dahlia/optique/issues/200
[#223]: https://github.com/dahlia/optique/issues/223
[#224]: https://github.com/dahlia/optique/issues/224
[#225]: https://github.com/dahlia/optique/issues/225
[#228]: https://github.com/dahlia/optique/issues/228
[#229]: https://github.com/dahlia/optique/issues/229
[#235]: https://github.com/dahlia/optique/issues/235
[#240]: https://github.com/dahlia/optique/issues/240
[#241]: https://github.com/dahlia/optique/issues/241
[#242]: https://github.com/dahlia/optique/issues/242
[#245]: https://github.com/dahlia/optique/issues/245
[#247]: https://github.com/dahlia/optique/issues/247
[#248]: https://github.com/dahlia/optique/issues/248
[#249]: https://github.com/dahlia/optique/issues/249
[#250]: https://github.com/dahlia/optique/issues/250
[#251]: https://github.com/dahlia/optique/issues/251
[#252]: https://github.com/dahlia/optique/issues/252
[#253]: https://github.com/dahlia/optique/issues/253
[#254]: https://github.com/dahlia/optique/issues/254
[#255]: https://github.com/dahlia/optique/issues/255
[#256]: https://github.com/dahlia/optique/issues/256
[#262]: https://github.com/dahlia/optique/issues/262
[#264]: https://github.com/dahlia/optique/issues/264
[#275]: https://github.com/dahlia/optique/issues/275
[#279]: https://github.com/dahlia/optique/issues/279
[#294]: https://github.com/dahlia/optique/issues/294
[#296]: https://github.com/dahlia/optique/issues/296
[#300]: https://github.com/dahlia/optique/issues/300
[#307]: https://github.com/dahlia/optique/issues/307
[#310]: https://github.com/dahlia/optique/issues/310
[#315]: https://github.com/dahlia/optique/issues/315
[#317]: https://github.com/dahlia/optique/issues/317
[#319]: https://github.com/dahlia/optique/issues/319
[#320]: https://github.com/dahlia/optique/issues/320
[#321]: https://github.com/dahlia/optique/issues/321
[#323]: https://github.com/dahlia/optique/issues/323
[#327]: https://github.com/dahlia/optique/issues/327
[#330]: https://github.com/dahlia/optique/issues/330
[#332]: https://github.com/dahlia/optique/issues/332
[#333]: https://github.com/dahlia/optique/issues/333
[#334]: https://github.com/dahlia/optique/issues/334
[#335]: https://github.com/dahlia/optique/issues/335
[#336]: https://github.com/dahlia/optique/issues/336
[#337]: https://github.com/dahlia/optique/issues/337
[#338]: https://github.com/dahlia/optique/issues/338
[#339]: https://github.com/dahlia/optique/issues/339
[#340]: https://github.com/dahlia/optique/issues/340
[#341]: https://github.com/dahlia/optique/issues/341
[#342]: https://github.com/dahlia/optique/issues/342
[#344]: https://github.com/dahlia/optique/issues/344
[#345]: https://github.com/dahlia/optique/issues/345
[#347]: https://github.com/dahlia/optique/issues/347
[#348]: https://github.com/dahlia/optique/issues/348
[#349]: https://github.com/dahlia/optique/issues/349
[#350]: https://github.com/dahlia/optique/issues/350
[#351]: https://github.com/dahlia/optique/issues/351
[#352]: https://github.com/dahlia/optique/issues/352
[#353]: https://github.com/dahlia/optique/issues/353
[#354]: https://github.com/dahlia/optique/issues/354
[#355]: https://github.com/dahlia/optique/issues/355
[#357]: https://github.com/dahlia/optique/issues/357
[#362]: https://github.com/dahlia/optique/issues/362
[#363]: https://github.com/dahlia/optique/issues/363
[#364]: https://github.com/dahlia/optique/issues/364
[#366]: https://github.com/dahlia/optique/issues/366
[#368]: https://github.com/dahlia/optique/issues/368
[#370]: https://github.com/dahlia/optique/issues/370
[#371]: https://github.com/dahlia/optique/issues/371
[#375]: https://github.com/dahlia/optique/issues/375
[#376]: https://github.com/dahlia/optique/issues/376
[#378]: https://github.com/dahlia/optique/issues/378
[#381]: https://github.com/dahlia/optique/issues/381
[#385]: https://github.com/dahlia/optique/issues/385
[#387]: https://github.com/dahlia/optique/issues/387
[#388]: https://github.com/dahlia/optique/issues/388
[#389]: https://github.com/dahlia/optique/issues/389
[#395]: https://github.com/dahlia/optique/issues/395
[#396]: https://github.com/dahlia/optique/issues/396
[#403]: https://github.com/dahlia/optique/issues/403
[#406]: https://github.com/dahlia/optique/issues/406
[#425]: https://github.com/dahlia/optique/issues/425
[#429]: https://github.com/dahlia/optique/issues/429
[#432]: https://github.com/dahlia/optique/issues/432
[#439]: https://github.com/dahlia/optique/issues/439
[#469]: https://github.com/dahlia/optique/issues/469
[#471]: https://github.com/dahlia/optique/issues/471
[#479]: https://github.com/dahlia/optique/issues/479
[#485]: https://github.com/dahlia/optique/issues/485
[#488]: https://github.com/dahlia/optique/issues/488
[#490]: https://github.com/dahlia/optique/pull/490
[#494]: https://github.com/dahlia/optique/issues/494
[#500]: https://github.com/dahlia/optique/issues/500
[#504]: https://github.com/dahlia/optique/issues/504
[#505]: https://github.com/dahlia/optique/issues/505
[#506]: https://github.com/dahlia/optique/issues/506
[#507]: https://github.com/dahlia/optique/issues/507
[#508]: https://github.com/dahlia/optique/issues/508
[#512]: https://github.com/dahlia/optique/pull/512
[#513]: https://github.com/dahlia/optique/issues/513
[#516]: https://github.com/dahlia/optique/issues/516
[#518]: https://github.com/dahlia/optique/issues/518
[#519]: https://github.com/dahlia/optique/issues/519
[#520]: https://github.com/dahlia/optique/pull/520
[#522]: https://github.com/dahlia/optique/pull/522
[#523]: https://github.com/dahlia/optique/pull/523
[#524]: https://github.com/dahlia/optique/pull/524
[#525]: https://github.com/dahlia/optique/pull/525
[#527]: https://github.com/dahlia/optique/pull/527
[#528]: https://github.com/dahlia/optique/pull/528
[#531]: https://github.com/dahlia/optique/pull/531
[#533]: https://github.com/dahlia/optique/pull/533
[#535]: https://github.com/dahlia/optique/pull/535
[#536]: https://github.com/dahlia/optique/pull/536
[#537]: https://github.com/dahlia/optique/pull/537
[#546]: https://github.com/dahlia/optique/pull/546
[#548]: https://github.com/dahlia/optique/pull/548
[#553]: https://github.com/dahlia/optique/pull/553
[#554]: https://github.com/dahlia/optique/pull/554
[#555]: https://github.com/dahlia/optique/pull/555
[#558]: https://github.com/dahlia/optique/pull/558
[#565]: https://github.com/dahlia/optique/pull/565
[#566]: https://github.com/dahlia/optique/pull/566
[#568]: https://github.com/dahlia/optique/pull/568
[#572]: https://github.com/dahlia/optique/pull/572
[#573]: https://github.com/dahlia/optique/pull/573
[#575]: https://github.com/dahlia/optique/pull/575
[#576]: https://github.com/dahlia/optique/pull/576
[#579]: https://github.com/dahlia/optique/pull/579
[#580]: https://github.com/dahlia/optique/pull/580
[#581]: https://github.com/dahlia/optique/pull/581
[#583]: https://github.com/dahlia/optique/pull/583
[#585]: https://github.com/dahlia/optique/pull/585
[#587]: https://github.com/dahlia/optique/pull/587
[#588]: https://github.com/dahlia/optique/pull/588
[#589]: https://github.com/dahlia/optique/pull/589
[#590]: https://github.com/dahlia/optique/issues/590
[#592]: https://github.com/dahlia/optique/pull/592
[#595]: https://github.com/dahlia/optique/pull/595
[#599]: https://github.com/dahlia/optique/pull/599
[#606]: https://github.com/dahlia/optique/pull/606
[#608]: https://github.com/dahlia/optique/pull/608
[#610]: https://github.com/dahlia/optique/pull/610
[#611]: https://github.com/dahlia/optique/pull/611
[#614]: https://github.com/dahlia/optique/pull/614
[#616]: https://github.com/dahlia/optique/pull/616
[#617]: https://github.com/dahlia/optique/pull/617
[#618]: https://github.com/dahlia/optique/issues/618
[#619]: https://github.com/dahlia/optique/pull/619
[#622]: https://github.com/dahlia/optique/pull/622
[#623]: https://github.com/dahlia/optique/issues/623
[#624]: https://github.com/dahlia/optique/pull/624
[#626]: https://github.com/dahlia/optique/pull/626
[#629]: https://github.com/dahlia/optique/pull/629
[#630]: https://github.com/dahlia/optique/pull/630
[#631]: https://github.com/dahlia/optique/pull/631
[#632]: https://github.com/dahlia/optique/pull/632
[#634]: https://github.com/dahlia/optique/pull/634
[#635]: https://github.com/dahlia/optique/pull/635
[#636]: https://github.com/dahlia/optique/pull/636
[#638]: https://github.com/dahlia/optique/pull/638
[#639]: https://github.com/dahlia/optique/pull/639
[#641]: https://github.com/dahlia/optique/pull/641
[#642]: https://github.com/dahlia/optique/pull/642
[#645]: https://github.com/dahlia/optique/pull/645
[#646]: https://github.com/dahlia/optique/pull/646
[#647]: https://github.com/dahlia/optique/issues/647
[#648]: https://github.com/dahlia/optique/pull/648
[#650]: https://github.com/dahlia/optique/pull/650
[#653]: https://github.com/dahlia/optique/pull/653
[#656]: https://github.com/dahlia/optique/pull/656
[#657]: https://github.com/dahlia/optique/pull/657
[#659]: https://github.com/dahlia/optique/pull/659
[#660]: https://github.com/dahlia/optique/pull/660
[#661]: https://github.com/dahlia/optique/pull/661
[#663]: https://github.com/dahlia/optique/pull/663
[#664]: https://github.com/dahlia/optique/pull/664
[#668]: https://github.com/dahlia/optique/pull/668
[#669]: https://github.com/dahlia/optique/pull/669
[#670]: https://github.com/dahlia/optique/pull/670
[#672]: https://github.com/dahlia/optique/issues/672
[#673]: https://github.com/dahlia/optique/pull/673
[#674]: https://github.com/dahlia/optique/pull/674
[#675]: https://github.com/dahlia/optique/pull/675
[#676]: https://github.com/dahlia/optique/pull/676
[#677]: https://github.com/dahlia/optique/pull/677
[#678]: https://github.com/dahlia/optique/pull/678
[#679]: https://github.com/dahlia/optique/pull/679
[#681]: https://github.com/dahlia/optique/issues/681
[#682]: https://github.com/dahlia/optique/pull/682
[#683]: https://github.com/dahlia/optique/pull/683
[#684]: https://github.com/dahlia/optique/issues/684
[#685]: https://github.com/dahlia/optique/pull/685
[#686]: https://github.com/dahlia/optique/pull/686
[#687]: https://github.com/dahlia/optique/pull/687
[#689]: https://github.com/dahlia/optique/pull/689
[#690]: https://github.com/dahlia/optique/pull/690
[#692]: https://github.com/dahlia/optique/pull/692
[#693]: https://github.com/dahlia/optique/pull/693
[#694]: https://github.com/dahlia/optique/pull/694
[#695]: https://github.com/dahlia/optique/pull/695
[#696]: https://github.com/dahlia/optique/pull/696
[#697]: https://github.com/dahlia/optique/pull/697
[#698]: https://github.com/dahlia/optique/pull/698
[#700]: https://github.com/dahlia/optique/pull/700
[#709]: https://github.com/dahlia/optique/pull/709
[#713]: https://github.com/dahlia/optique/pull/713
[#714]: https://github.com/dahlia/optique/pull/714
[#715]: https://github.com/dahlia/optique/issues/715
[#716]: https://github.com/dahlia/optique/pull/716
[#717]: https://github.com/dahlia/optique/pull/717
[#718]: https://github.com/dahlia/optique/pull/718
[#719]: https://github.com/dahlia/optique/pull/719
[#720]: https://github.com/dahlia/optique/pull/720
[#721]: https://github.com/dahlia/optique/pull/721
[#722]: https://github.com/dahlia/optique/pull/722
[#723]: https://github.com/dahlia/optique/pull/723

### @optique/config

 -  Removed `configKey` symbol.  Each `ConfigContext` instance now stores
    its data under its own unique `id` symbol (i.e., `context.id`) so that
    multiple config contexts can coexist without overwriting each other in
    merged annotations.  This is a breaking change for any code that accessed
    annotations directly via `configKey`.  [[#136]]

 -  Removed `runWithConfig()` and the `@optique/config/run` subpath export.
    Config contexts are now used directly with `run()`, `runSync()`, or
    `runAsync()` from *@optique/run* (or `runWith()` from
    `@optique/core/facade`) via the `contexts` option.  Context-specific
    options like `getConfigPath` and `load` are passed alongside the standard
    runner options.  This is a breaking change.  [[#110]]

 -  Moved `fileParser` option from `runWithConfig()` runtime options into
    `createConfigContext()` options.  The file parser is now stored in the
    context at creation time.  [[#110]]

 -  Changed `ConfigContextRequiredOptions` to make both `getConfigPath` and
    `load` optional fields (with runtime validation that at least one is
    provided).  [[#110]]

 -  Added `ConfigContext` implementation of `Symbol.dispose` for automatic
    cleanup of the global config registry.  [[#110]]

 -  Fixed `createConfigContext()` breaking sync runner flows.  When config
    loading and schema validation complete synchronously, config contexts now
    return annotations without a Promise so documented `runSync()` and
    `runWithSync()` config fallbacks work again.  [[#159], [#162]]

 -  Fixed `bindConfig()` composition with `bindEnv()`: when no CLI token is
    consumed, `bindConfig()` no longer incorrectly marks the result as
    “CLI-provided”, which was causing `bindEnv(bindConfig(…))` to skip the
    environment-variable fallback even when the CLI option was absent.

 -  Fixed `bindConfig()` silently swallowing exceptions thrown by `key`
    callbacks.  Errors now propagate to the caller instead of being
    treated as a missing config value.  [[#259], [#549]]

 -  Added config-source metadata support for `bindConfig()` key accessors.
    Accessor callbacks now receive a second `meta` argument, and single-file
    mode now provides default `ConfigMeta` values (`configPath`, `configDir`)
    so path-like options can be resolved relative to the config file location.
    [[#111]]

 -  Changed `CustomLoadOptions.load` to return
    `{ config, meta }` (`ConfigLoadResult<TConfigMeta>`) instead of raw config
    data.  This makes metadata extensible for custom multi-file loaders and
    allows `createConfigContext<T, TConfigMeta>()` to carry a custom metadata
    type through to `bindConfig()` key callbacks.  [[#111]]

 -  Fixed `bindConfig()` and `ConfigLoadResult` type signatures to reflect
    that config metadata can be absent.  Key callbacks now receive
    `TConfigMeta | undefined`, and `ConfigLoadResult.meta` is typed as
    `TConfigMeta | undefined` to match runtime behavior.  [[#155]]

 -  Fixed `createConfigContext()` treating falsy first-pass parse results
    such as `0`, `false`, and `""` as the phase-one sentinel.  Dynamic
    config loading now skips only when the parsed value is actually
    `undefined`, so top-level primitive parsers still reach the second
    config-loading phase correctly.  [[#161], [#164]]

 -  Fixed phase-two `load(parsed)` / `getConfigPath(parsed)` inputs for
    unresolved prompt-backed values.  Config callbacks now receive scrubbed
    parsed values with deferred prompt placeholders normalized to
    `undefined`, while keeping the original parsed object identity when no
    sanitization is needed.  [[#177], [#490]]

 -  Fixed proxy-based sanitization of deferred prompt values breaking class
    methods that access private fields.  Methods on non-plain objects are now
    invoked with temporarily sanitized own properties on the original instance,
    allowing private field access to work correctly through the sanitized
    view.  [[#307], [#558]]

 -  `createConfigContext()` now validates `schema` and `fileParser` at
    construction time, and `getAnnotations()` validates `load` and
    `getConfigPath` types.  Malformed values now throw a `TypeError`
    immediately instead of surfacing as late internal errors during
    annotation loading.  [[#391], [#605]]

 -  `createConfigContext()` now validates that `getConfigPath()` returns
    a string or `undefined` at runtime.  Malformed return values (objects,
    Promises, numbers, etc.) now throw a `TypeError` instead of crashing
    with a raw `path.resolve()` error.  [[#416], [#609]]

 -  `bindConfig()` now throws a `TypeError` when `key` is not a valid
    property key (string, number, or symbol) or function, instead of
    silently coercing the value.  [[#398], [#627]]

 -  `bindConfig()` now throws a `TypeError` at parse time when a `key`
    callback returns a `Promise` or thenable, instead of silently
    leaking the thenable as the parsed value.  [[#400], [#628]]

 -  `createConfigContext()` now validates `load()` return values at runtime.
    Malformed results (missing `config` property, non-object or array returns,
    plain thenables returned directly from `load()`, or Promise-valued
    `config`/`meta` fields) now throw `TypeError` instead of causing silent
    failures.  [[#411], [#655]]

 -  Fixed `bindConfig()` not propagating dependency source values to derived
    parsers.  When a `dependency()` option was wrapped with `bindConfig()`,
    the config-resolved value was invisible to derived parsers, which fell
    back to `defaultValue()` instead.  [[#179], [#680]]

[#111]: https://github.com/dahlia/optique/issues/111
[#136]: https://github.com/dahlia/optique/issues/136
[#155]: https://github.com/dahlia/optique/issues/155
[#159]: https://github.com/dahlia/optique/issues/159
[#161]: https://github.com/dahlia/optique/issues/161
[#162]: https://github.com/dahlia/optique/pull/162
[#164]: https://github.com/dahlia/optique/pull/164
[#179]: https://github.com/dahlia/optique/issues/179
[#259]: https://github.com/dahlia/optique/issues/259
[#391]: https://github.com/dahlia/optique/issues/391
[#398]: https://github.com/dahlia/optique/issues/398
[#400]: https://github.com/dahlia/optique/issues/400
[#411]: https://github.com/dahlia/optique/issues/411
[#416]: https://github.com/dahlia/optique/issues/416
[#549]: https://github.com/dahlia/optique/pull/549
[#605]: https://github.com/dahlia/optique/pull/605
[#609]: https://github.com/dahlia/optique/pull/609
[#627]: https://github.com/dahlia/optique/pull/627
[#628]: https://github.com/dahlia/optique/pull/628
[#655]: https://github.com/dahlia/optique/pull/655
[#680]: https://github.com/dahlia/optique/pull/680

### @optique/env

The *@optique/env* package was introduced in this release, providing
environment variable integration via source contexts.  [[#86], [#135]]

 -  Added `createEnvContext()` for creating static environment contexts with
    optional key prefixes and custom source functions.

 -  Added `bindEnv()` for parser fallback behavior with priority order
    CLI > environment > default.

 -  Added `bool()` value parser for common environment Boolean literals
    (`true`, `false`, `1`, `0`, `yes`, `no`, `on`, `off`).

 -  `bool()` now provides value completion suggestions for all accepted
    literals, not just the canonical `true`/`false`.  [[#268], [#562]]

 -  Added support for env-only values via `bindEnv(fail<T>(), ...)` when a
    value should not be exposed as a CLI option.

 -  `createEnvContext()` now validates `prefix` at runtime, rejecting
    non-string values with a `TypeError`.  [[#384], [#652]]

 -  `createEnvContext()` now throws a `TypeError` when `source` is not
    a function, instead of deferring the crash to environment lookup time.
    [[#390], [#600]]

 -  `bindEnv()` now throws a `TypeError` when `key` is not a string,
    instead of deferring the crash to environment lookup time.
    [[#398], [#627]]

 -  `bindEnv()` now produces a clear failure when `EnvSource` returns
    a non-string value, instead of leaking it through or crashing
    downstream value parsers.  [[#399], [#633]]

 -  `bindEnv()` now throws a `TypeError` when `parser` is not a valid
    `ValueParser`, instead of deferring the crash to environment lookup
    time.  [[#415], [#637]]

 -  Fixed `bindEnv()` not propagating dependency source values to derived
    parsers.  When a `dependency()` option was wrapped with `bindEnv()`,
    the env-resolved value was invisible to derived parsers, which fell
    back to `defaultValue()` instead.  [[#179]]

[#86]: https://github.com/dahlia/optique/issues/86
[#135]: https://github.com/dahlia/optique/pull/135
[#268]: https://github.com/dahlia/optique/issues/268
[#384]: https://github.com/dahlia/optique/issues/384
[#390]: https://github.com/dahlia/optique/issues/390
[#399]: https://github.com/dahlia/optique/issues/399
[#415]: https://github.com/dahlia/optique/issues/415
[#562]: https://github.com/dahlia/optique/pull/562
[#600]: https://github.com/dahlia/optique/pull/600
[#633]: https://github.com/dahlia/optique/pull/633
[#637]: https://github.com/dahlia/optique/pull/637
[#652]: https://github.com/dahlia/optique/pull/652

### @optique/git

 -  Fixed `gitRef()` emitting duplicate completion suggestions when a branch
    and tag share the same name.  [[#284], [#569]]

 -  Fixed `gitCommit()` and `gitRef()` suggesting abbreviated commit SHAs
    shorter than the typed prefix, which caused shell completion frontends
    to drop the suggestions.  Suggested OIDs are now at least as long as
    the prefix.  [[#569]]

 -  `gitCommit()`, `gitRef()`, and other git parser functions now throw
    a `RangeError` when `suggestionDepth` is not a positive integer,
    instead of silently accepting invalid values.  [[#377], [#570]]

 -  Fixed `gitCommit()` and `gitRef()` suggesting ambiguous 7-character SHA
    prefixes when multiple recent commits share the same short prefix.
    Short SHAs are now lengthened until each suggestion is unique.
    [[#331], [#571]]

 -  Fixed `gitRemoteBranch()` reporting a misleading “branch not found” error
    when the specified remote does not exist.  The parser now correctly
    diagnoses the missing remote.  Added `remoteNotFound` to
    `GitParserErrors` for custom error messages in this case.  [[#308], [#603]]

 -  `gitRemoteBranch()` now validates the `remote` parameter at construction
    time, rejecting empty, whitespace-only, control-character-containing,
    multiline, or non-string values
    with a `TypeError`.  [[#464], [#654]]

[#284]: https://github.com/dahlia/optique/issues/284
[#308]: https://github.com/dahlia/optique/issues/308
[#331]: https://github.com/dahlia/optique/issues/331
[#377]: https://github.com/dahlia/optique/issues/377
[#464]: https://github.com/dahlia/optique/issues/464
[#569]: https://github.com/dahlia/optique/pull/569
[#570]: https://github.com/dahlia/optique/pull/570
[#571]: https://github.com/dahlia/optique/pull/571
[#603]: https://github.com/dahlia/optique/pull/603
[#654]: https://github.com/dahlia/optique/pull/654

### @optique/inquirer

The *@optique/inquirer* package was introduced in this release, providing
interactive prompt fallback integration via Inquirer.js.  [[#87], [#137]]

 -  Added `prompt()` for wrapping any parser with an interactive prompt that
    fires when no CLI value is provided.  Supports ten prompt types:
    `input`, `password`, `number`, `confirm`, `select`, `rawlist`, `expand`,
    `checkbox`, `editor`, and a custom `prompter` escape hatch.

 -  Added `Choice` and `ExpandChoice` interfaces for selection-type prompts
    (`select`, `rawlist`, `expand`, `checkbox`).

 -  Re-exports `Separator` from `@inquirer/prompts` for use in choice lists.

 -  `prompt()` always returns an async parser (`$mode: "async"`) and integrates
    cleanly with `bindEnv()` and `bindConfig()` — the prompt is skipped
    whenever the CLI, environment variable, or config file supplies a value.

 -  Fixed `prompt()` leaving `ExitPromptError` uncaught when a user cancels an
    Inquirer prompt with <kbd>^C</kbd>.  Prompt cancellation is now converted
    into a normal parse failure (`Prompt cancelled.`) instead of surfacing as
    an unhandled promise rejection.  [[#151]]

 -  Fixed `prompt()` not attempting inner parser completion when the CLI state
    is wrapped by `optional()` (array form).  When the inner parser carries a
    config-prompt deferral hook, `prompt()` now delegates to the inner parser's
    `complete()` so that config values propagate through wrapper combinators
    like `optional(bindConfig(...))`.  [[#385], [#535]]

 -  Fixed `prompt(optional(...))` and `prompt(withDefault(...))` inside
    `object()` silently skipping the prompt and returning the
    optional/default value instead.  [[#288], [#540]]

 -  Fixed `prompt()` double-wrapping already-optional inner parsers, which
    caused help usage to render `[[--name STRING]]` instead of
    `[--name STRING]`.  [[#289], [#582]]

 -  Fixed `prompt()` crashing with an internal `TypeError` when an unsupported
    `type` value is passed at runtime through an untyped path.  It now throws
    a clear `TypeError` with the invalid type name up front.  [[#386], [#612]]

 -  *Behavioral change:* `prompt()` no longer re-validates prompted values
    through the inner parser's constraint pipeline.  The CLI path and the
    prompt path are now treated as independent value sources.  Previously,
    prompted values were fed back through a synthetic parse, which caused
    false rejections when value-transforming combinators like `map()` changed
    the value domain.  This means prompted values are no longer checked
    against constraints like `integer({ min, max })`, `string({ pattern })`,
    or `choice()` — those constraints only apply to CLI input.  Use the
    prompt config's `validate`, `min`/`max`/`step`, or `choices` options
    to enforce equivalent constraints on prompted values.
    [[#392], [#613], [#615], [#621]]

 -  Added `validate` support to `SelectConfig`, `RawlistConfig`,
    `ExpandConfig`, and `CheckboxConfig` prompt configurations.  Return
    `true` to accept, or a string error message to reject and re-prompt.
    [[#620], [#625]]

[#87]: https://github.com/dahlia/optique/issues/87
[#137]: https://github.com/dahlia/optique/pull/137
[#151]: https://github.com/dahlia/optique/issues/151
[#288]: https://github.com/dahlia/optique/issues/288
[#289]: https://github.com/dahlia/optique/issues/289
[#386]: https://github.com/dahlia/optique/issues/386
[#392]: https://github.com/dahlia/optique/issues/392
[#540]: https://github.com/dahlia/optique/pull/540
[#582]: https://github.com/dahlia/optique/pull/582
[#612]: https://github.com/dahlia/optique/pull/612
[#613]: https://github.com/dahlia/optique/pull/613
[#615]: https://github.com/dahlia/optique/issues/615
[#620]: https://github.com/dahlia/optique/issues/620
[#621]: https://github.com/dahlia/optique/pull/621
[#625]: https://github.com/dahlia/optique/pull/625

### @optique/logtape

 -  `debug()`, `verbosity()`, and `loggingOptions()` now validate log level
    options (`debugLevel`, `normalLevel`, `baseLevel`, `default`) at runtime
    and throw `TypeError` for invalid values.  Previously, invalid strings
    passed via type assertions (e.g., `as never`) would silently leak into
    successful parse results.  [[#430], [#711]]

 -  Fixed `createSink()` misreporting `getFileSink()` factory errors as
    missing `@logtape/file` package.  Previously, any error thrown after the
    dynamic import (e.g., file permission errors) was caught and rewritten
    as an installation hint.  Now only actual import failures produce the
    installation message; factory errors propagate as-is.  [[#299], [#702]]

 -  Fixed `logOutput()` to request hidden-file completion for dot-prefixed
    paths.  Previously, tab-completion for paths like `.` or `src/.` would
    not suggest hidden files or directories.  [[#292], [#699]]

 -  Fixed `createSink()` failing on Deno when installed from JSR because
    `@logtape/file` was not declared in the package's import map.  The
    dynamic import could not resolve the bare specifier even if the user
    had installed `@logtape/file`.  [[#329], [#703]]

 -  Fixed `createConsoleSink()` ignoring falsy timestamps like `0` and
    substituting the current time.  A truthiness check on
    `record.timestamp` treated the valid Unix epoch timestamp `0` as
    absent.  [[#311], [#705]]

 -  Fixed `createConsoleSink()` silently treating invalid `stream` and
    `streamResolver` return values as stdout.  Invalid static `stream`
    values now throw `TypeError` when `streamResolver` is not provided,
    and invalid `streamResolver` return values throw `TypeError` at log
    time.  [[#379], [#707]]

 -  `ConsoleSinkOptions.stream` now also accepts `null`, which is treated
    the same as `undefined` (defaults to `"stderr"`).  [[#379], [#707]]

 -  Fixed `logOutput()` not validating empty runtime `metavar` values.
    Previously, passing an empty string as `metavar` would silently produce
    malformed help output.  Now it throws `TypeError` like all other value
    parsers.  [[#459], [#708]]

 -  Fixed `loggingOptions()` not validating invalid runtime `level`
    discriminants.  Previously, passing an unsupported `level` value (e.g.,
    from untyped JavaScript) would cause an internal crash during parser
    assembly.  Now it throws `TypeError` with a clear message.  [[#373], [#710]]

[#292]: https://github.com/dahlia/optique/issues/292
[#299]: https://github.com/dahlia/optique/issues/299
[#311]: https://github.com/dahlia/optique/issues/311
[#329]: https://github.com/dahlia/optique/issues/329
[#373]: https://github.com/dahlia/optique/issues/373
[#379]: https://github.com/dahlia/optique/issues/379
[#430]: https://github.com/dahlia/optique/issues/430
[#459]: https://github.com/dahlia/optique/issues/459
[#699]: https://github.com/dahlia/optique/pull/699
[#702]: https://github.com/dahlia/optique/pull/702
[#703]: https://github.com/dahlia/optique/pull/703
[#705]: https://github.com/dahlia/optique/pull/705
[#707]: https://github.com/dahlia/optique/pull/707
[#708]: https://github.com/dahlia/optique/pull/708
[#710]: https://github.com/dahlia/optique/pull/710
[#711]: https://github.com/dahlia/optique/pull/711

### @optique/temporal

 -  Temporal parsers now throw a `TypeError` when `globalThis.Temporal` is
    unavailable, instead of silently returning an “invalid format” error.
    This makes it clear that the runtime lacks Temporal support and a polyfill
    is needed.  [[#282], [#561]]

 -  Fixed `TimeZone` type to include single-segment IANA timezone identifiers
    such as `"GMT"`, `"EST"`, and deprecated aliases like
    `"Japan"` and `"Cuba"`.  These were already accepted at runtime by the
    `timeZone()` parser but excluded from the static type.  [[#304], [#596]]

 -  Changed the default metavar for `plainMonthDay()` from `"--MONTH-DAY"` to
    `"MONTH-DAY"`.  The previous metavar confused help text because it looked
    like a CLI option flag (e.g., `--birthday --MONTH-DAY`), and was
    inconsistent with the canonical format `"01-23"` produced by
    `format()`.  [[#306], [#643]]

 -  Temporal plain parsers now enforce strict input shapes matching their
    advertised types, rejecting wider ISO forms that were previously silently
    accepted.  For example, `plainDate()` no longer accepts datetime strings
    like `"2020-01-23T17:04:36"`, and `plainDateTime()` no longer accepts
    date-only strings like `"2020-01-23"`.  [[#314], [#649]]

[#282]: https://github.com/dahlia/optique/issues/282
[#304]: https://github.com/dahlia/optique/issues/304
[#306]: https://github.com/dahlia/optique/issues/306
[#314]: https://github.com/dahlia/optique/issues/314
[#561]: https://github.com/dahlia/optique/pull/561
[#596]: https://github.com/dahlia/optique/pull/596
[#643]: https://github.com/dahlia/optique/pull/643
[#649]: https://github.com/dahlia/optique/pull/649

### @optique/run

 -  Added `stdout`, `stderr`, and `onExit` options to `run()`, `runSync()`,
    and `runAsync()` for dependency injection of process-integrated behavior.
    This allows embedding and test environments to capture output and control
    exit handling without monkey-patching `process.stdout`/`process.stderr`
    or `process.exit`.  By default, behavior is unchanged
    (`process.stdout.write`, `process.stderr.write`, and `process.exit`).
    [[#112]]

 -  Redesigned `RunOptions.help`, `RunOptions.version`, and
    `RunOptions.completion` to use the new `command`/`option` sub-config
    structure from *@optique/core*.  String shorthands (`"command"`,
    `"option"`, `"both"`) and the version string shorthand are preserved
    for convenience.  Object configurations now use `{ command, option }`
    instead of `{ mode }`.  [[#130]]

 -  Removed `CompletionHelpVisibility`, `CompletionOptionsBase`,
    `CompletionOptionsBoth`, `CompletionOptionsSingular`,
    `CompletionOptionsPlural`, and `CompletionOptions` types.  [[#130]]

 -  Fixed `run()`, `runSync()`, and `runAsync()` overload resolution for
    `Program` values used with `contexts`.  Context-aware `Program` calls
    now preserve the correct return type and accept context-specific runner
    options instead of falling back to the plain `Program` overloads.
    The stricter plain-`Program` overloads also reject option variables
    whose types add keys outside `RunOptions`, preserving the tighter
    direct-call checks introduced by this change set.  [[#160], [#163]]

 -  Fixed `runSync()` accepting async parser objects (including `Program`
    wrapping async parsers) at runtime and returning `Promise`s instead of
    throwing.  `runSync()` now validates `parser.$mode` at runtime and throws
    `TypeError` if the parser is not synchronous.  [[#279], [#676]]

 -  Fixed `path()` extension validation for dotfiles (e.g., `.env`,
    `.gitignore`) and multi-part extensions (e.g., `.tar.gz`, `.d.ts`).
    Previously, `extname()` only returned the last extension segment, so
    these cases were incorrectly rejected.  [[#309], [#530]]

 -  Fixed `path()` to reject empty and whitespace-only strings.
    Previously, these were silently accepted as valid paths in
    non-`mustExist` modes.  [[#343], [#538]]

 -  Fixed `path()` applying `extensions` validation even when
    `type: "directory"` is set.  Extensions are now skipped for
    directory-type paths.  [[#257], [#539]]

 -  Fixed `path()` to reject configurations where both `mustExist` and
    `mustNotExist` are set.  Previously, the contradictory configuration
    was silently accepted.  [[#358], [#541]]

 -  Fixed `path().suggest()` not enabling hidden-file completion for nested
    dotfile prefixes like `src/.` or `nested/path/.`.  Previously, only bare
    dot prefixes (e.g., `.`) set `includeHidden`.  [[#258], [#543]]

 -  Fixed `path()` to reject invalid runtime `type` values.  Previously,
    unsupported values like `"files"` were silently accepted, causing
    inconsistent behavior between parsing and suggestions.  [[#361], [#545]]

 -  Context-required options passed to `run()`, `runSync()`, and `runAsync()`
    must now be wrapped in a `contextOptions` property instead of being
    passed as top-level keys.  This prevents name collisions with runner
    options such as `help`, `programName`, and `version`.
    [[#240], [#241], [#575], [#581]]

 -  `path()` now throws `TypeError` at construction time when `mustExist`,
    `mustNotExist`, or `allowCreate` receive non-Boolean values.  Previously,
    JavaScript truthiness silently coerced invalid values like `"no"` into
    `true`.  [[#383], [#591]]

 -  Fixed `path()` to reject non-string extension entries at construction
    time.  Previously, non-string values (e.g., numbers) bypassed the
    leading-dot validation and leaked into error messages and completion
    payloads.  [[#346], [#651]]

[#112]: https://github.com/dahlia/optique/issues/112
[#160]: https://github.com/dahlia/optique/issues/160
[#163]: https://github.com/dahlia/optique/pull/163
[#257]: https://github.com/dahlia/optique/issues/257
[#258]: https://github.com/dahlia/optique/issues/258
[#309]: https://github.com/dahlia/optique/issues/309
[#343]: https://github.com/dahlia/optique/issues/343
[#346]: https://github.com/dahlia/optique/issues/346
[#358]: https://github.com/dahlia/optique/issues/358
[#361]: https://github.com/dahlia/optique/issues/361
[#383]: https://github.com/dahlia/optique/issues/383
[#530]: https://github.com/dahlia/optique/pull/530
[#538]: https://github.com/dahlia/optique/pull/538
[#539]: https://github.com/dahlia/optique/pull/539
[#541]: https://github.com/dahlia/optique/pull/541
[#543]: https://github.com/dahlia/optique/pull/543
[#545]: https://github.com/dahlia/optique/pull/545
[#591]: https://github.com/dahlia/optique/pull/591
[#651]: https://github.com/dahlia/optique/pull/651

### @optique/man

 -  Fixed `formatDateForMan()` to throw a `RangeError` for invalid `Date`
    objects instead of formatting them as `"undefined NaN"`.  [[#266], [#607]]

 -  Fixed `formatDocPageAsMan()` to include `DocEntry.choices` in man page
    output.  Previously, available choices were silently dropped.
    [[#265], [#604]]

 -  Fixed `formatDocPageAsMan()` to fall back to `DocPage.examples`,
    `DocPage.author`, and `DocPage.bugs` when the corresponding
    `ManPageOptions` fields are absent.  Previously, those page-level
    metadata fields were silently ignored unless duplicated in the options.
    [[#263], [#602]]

 -  Fixed `formatDocPageAsMan()` to respect command `usageLine` overrides
    in the SYNOPSIS section.  Previously, the man page formatter always
    rendered the default command usage, ignoring custom `usageLine` values.
    [[#237], [#593]]

 -  Changed `ManPageOptions.seeAlso[].section` type from `number` to
    `ManPageSection` and added runtime validation that rejects invalid section
    numbers (must be integers 1–8).  Previously, fractional or negative numbers
    were silently serialized into malformed `.BR` cross-references.
    [[#380], [#578]]

 -  `generateManPageSync()`, `generateManPageAsync()`, and `generateManPage()`
    now validate that the input is a genuine Optique `Parser` or `Program`
    up front, instead of accepting malformed objects and crashing with an
    internal `getDocFragments is not a function` error.  [[#305], [#567]]

 -  Fixed `generateManPage()` leaving empty wrappers and dangling separators
    in SYNOPSIS when hidden terms are nested inside `optional`, `multiple`,
    or `exclusive` usage nodes.  Empty wrapper nodes are now collapsed and
    exclusive separators are cleaned up after hidden terms are removed.
    [[#222], [#526]]

 -  Fixed `formatUsageTermAsRoff()` incorrectly hiding `hidden: "doc"` terms
    from SYNOPSIS.  Since SYNOPSIS is usage output, only usage-hidden terms
    (`hidden: true`, `"usage"`, `"help"`) are now suppressed.
    [[#221], [#222], [#526], [#529]]

 -  The `optique-man` CLI now rejects empty strings for `--name`, `--date`,
    `--version-string`, and `--manual` options instead of generating malformed
    `.TH` header lines.  [[#283], [#532]]

 -  Fixed `optique-man` not recognizing `.tsx` and `.jsx` input files as
    needing the `tsx` loader on Node.js, causing `ERR_UNKNOWN_FILE_EXTENSION`
    errors instead of the intended TypeScript-handling flow.  [[#280], [#534]]

 -  Fixed `optique-man` CLI not defaulting `--date` to the current date when
    omitted.  The help text documented “defaults to the current date” but
    `undefined` was passed through, producing an empty date field in the `.TH`
    header.  [[#276], [#547]]

 -  Fixed `formatDocPageAsMan()` not escaping hyphens and roff special
    characters (backslashes, line-start periods/quotes) in program names,
    command names, and `SEE ALSO` reference names.  [[#274], [#542]]

 -  Fixed `formatMessageAsRoff()` not escaping double quotes inside
    `value()` and `values()` terms, which produced malformed roff output.
    [[#273], [#544]]

 -  Fixed `optique-man` inferring an empty program name for extensionless
    input files.  `inferNameFromPath()` returned an empty string because
    `base.slice(0, -0)` yields `""` in JavaScript.  [[#277], [#551]]

 -  Fixed `optique-man` accepting malformed parser-like or program-like
    exports that pass shallow validation but crash later with internal
    generation errors.  The `isParser()` guard now checks for the
    `getDocFragments` method, and `isProgram()` now validates that
    `metadata.name` is a string and that the nested `parser` passes
    `isParser()`.  Both guards also catch exceptions from throwing
    accessors.  [[#278], [#552]]

 -  `formatDocPageAsMan()` and the `generateManPage*()` functions now throw
    a `TypeError` when `name` is an empty string, instead of generating
    malformed man page output.  [[#286], [#556]]

 -  `formatDocPageAsMan()` and the `generateManPage*()` functions now throw
    a `RangeError` when `section` is not a valid man page section number
    (1–8), instead of generating malformed man page output.  [[#287], [#557]]

 -  Fixed `formatDocPageAsMan()` emitting `literal` usage/doc terms without
    roff line-start escaping.  Values starting with `.` or `'` (e.g., `.env`)
    were interpreted by roff as requests instead of visible text.
    [[#297], [#559]]

 -  Fixed `formatDocPageAsMan()` emitting raw section titles into `.SH`
    macros without escaping or quoting.  Backslashes and double quotes in
    group labels are now escaped so they render literally in the man page.
    [[#301], [#560]]

 -  Fixed `formatUsageTermAsRoff()` and `formatDocPageAsMan()` dropping
    backslashes from metavar values in usage and doc terms.  Roff consumed
    sequences like `\T` as escapes, corrupting the rendered man page.
    [[#298], [#563]]

 -  Fixed `formatDocPageAsMan()` treating empty `date`, `version`, and
    `manual` strings as present values, producing malformed `.TH` headers
    with empty quoted fields.  Empty strings are now treated as absent.
    [[#303], [#564]]

 -  Fixed `formatDocPageAsMan()` emitting raw program and `SEE ALSO` names
    into roff macros (`.TH`, `.B`, `.BR`) without quoting.  Names containing
    spaces, backslashes, or quotes were corrupted by the renderer because
    roff parsed them as macro syntax.  [[#302], [#574]]

 -  `generateManPageSync()` now throws `TypeError` at runtime when given an
    async parser or program.  Previously it silently produced output; now
    callers must use `generateManPageAsync()` or `generateManPage()` for async
    parsers.  [[#291], [#584]]

 -  Fixed `formatUsageTermAsRoff()` rendering optional and Boolean options
    with duplicated brackets (e.g., `[[--host STRING]]`) in the SYNOPSIS
    section.  The `optional` and `multiple` wrappers now avoid adding
    redundant brackets around inner `option` terms that already imply
    optionality.  [[#197], [#586]]

 -  Fixed `generateManPage*()` dropping `brief`, `description`, and `footer`
    from `Program` metadata.  These fields are now forwarded to the man page
    output.  Added `brief`, `description`, and `footer` to `ManPageOptions`
    so they can also be passed as explicit overrides in both the parser-based
    and program-based APIs.  [[#260], [#598]]

 -  Fixed `formatDocPageAsMan()` labeling untitled sections as `OPTIONS`
    regardless of entry kinds.  Untitled command-only sections now render
    as `COMMANDS`, and untitled argument-only sections render as `ARGUMENTS`.
    [[#261], [#601]]

[#197]: https://github.com/dahlia/optique/issues/197
[#221]: https://github.com/dahlia/optique/issues/221
[#222]: https://github.com/dahlia/optique/issues/222
[#237]: https://github.com/dahlia/optique/issues/237
[#260]: https://github.com/dahlia/optique/issues/260
[#261]: https://github.com/dahlia/optique/issues/261
[#263]: https://github.com/dahlia/optique/issues/263
[#265]: https://github.com/dahlia/optique/issues/265
[#266]: https://github.com/dahlia/optique/issues/266
[#273]: https://github.com/dahlia/optique/issues/273
[#274]: https://github.com/dahlia/optique/issues/274
[#276]: https://github.com/dahlia/optique/issues/276
[#277]: https://github.com/dahlia/optique/issues/277
[#278]: https://github.com/dahlia/optique/issues/278
[#280]: https://github.com/dahlia/optique/issues/280
[#283]: https://github.com/dahlia/optique/issues/283
[#286]: https://github.com/dahlia/optique/issues/286
[#287]: https://github.com/dahlia/optique/issues/287
[#291]: https://github.com/dahlia/optique/issues/291
[#297]: https://github.com/dahlia/optique/issues/297
[#298]: https://github.com/dahlia/optique/issues/298
[#301]: https://github.com/dahlia/optique/issues/301
[#302]: https://github.com/dahlia/optique/issues/302
[#303]: https://github.com/dahlia/optique/issues/303
[#305]: https://github.com/dahlia/optique/issues/305
[#380]: https://github.com/dahlia/optique/issues/380
[#526]: https://github.com/dahlia/optique/pull/526
[#529]: https://github.com/dahlia/optique/pull/529
[#532]: https://github.com/dahlia/optique/pull/532
[#534]: https://github.com/dahlia/optique/pull/534
[#542]: https://github.com/dahlia/optique/pull/542
[#544]: https://github.com/dahlia/optique/pull/544
[#547]: https://github.com/dahlia/optique/pull/547
[#551]: https://github.com/dahlia/optique/pull/551
[#552]: https://github.com/dahlia/optique/pull/552
[#556]: https://github.com/dahlia/optique/pull/556
[#557]: https://github.com/dahlia/optique/pull/557
[#559]: https://github.com/dahlia/optique/pull/559
[#560]: https://github.com/dahlia/optique/pull/560
[#563]: https://github.com/dahlia/optique/pull/563
[#564]: https://github.com/dahlia/optique/pull/564
[#567]: https://github.com/dahlia/optique/pull/567
[#574]: https://github.com/dahlia/optique/pull/574
[#578]: https://github.com/dahlia/optique/pull/578
[#584]: https://github.com/dahlia/optique/pull/584
[#586]: https://github.com/dahlia/optique/pull/586
[#593]: https://github.com/dahlia/optique/pull/593
[#598]: https://github.com/dahlia/optique/pull/598
[#601]: https://github.com/dahlia/optique/pull/601
[#602]: https://github.com/dahlia/optique/pull/602
[#604]: https://github.com/dahlia/optique/pull/604
[#607]: https://github.com/dahlia/optique/pull/607

### @optique/valibot

 -  `valibot()` now exposes choice metadata for `v.picklist()`,
    string-valued `v.literal()` schemas, and `v.union()` schemas composed
    entirely of string literals.  Help text with `showChoices` enabled
    now displays valid choices (e.g., `(choices: debug, info, warn, error)`),
    and shell completion suggests matching values.  [[#281], [#688]]

 -  `valibot()` now infers the metavar `"CHOICE"` instead of `"VALUE"` for
    `v.literal()` schemas with string values, and for `v.union()` schemas
    composed entirely of string literals.  [[#281], [#688]]

 -  `valibot()` now validates the `metavar` option at runtime and throws
    a `TypeError` for empty strings.  Previously, an empty `metavar` would
    silently produce malformed help output.  [[#460], [#691]]

 -  `valibot()` now throws a `TypeError` at construction time when given an
    async schema (e.g., `v.pipeAsync()` with `v.checkAsync()`).  Previously,
    async validations were silently skipped by the synchronous `safeParse()`
    call.  [[#462], [#701]]

 -  `valibot()` now formats transformed non-primitive values intelligently
    instead of producing `[object Object]`.  `Date` values use `.toISOString()`
    for stable output.  Plain objects use `JSON.stringify()`, while arrays
    use `String()` to preserve round-trip compatibility for common transforms.
    A new `format` option in `ValibotParserOptions` allows custom formatting.
    [[#285], [#706]]

[#281]: https://github.com/dahlia/optique/issues/281
[#285]: https://github.com/dahlia/optique/issues/285
[#460]: https://github.com/dahlia/optique/issues/460
[#462]: https://github.com/dahlia/optique/issues/462
[#688]: https://github.com/dahlia/optique/pull/688
[#691]: https://github.com/dahlia/optique/pull/691
[#701]: https://github.com/dahlia/optique/pull/701
[#706]: https://github.com/dahlia/optique/pull/706

### @optique/zod

 -  `zod()` now exposes choice metadata for `z.enum()`, string-valued
    `z.nativeEnum()` and `z.literal()` schemas, and `z.union()` schemas
    composed entirely of string literals.  Help text with `showChoices`
    enabled now displays valid choices (e.g.,
    `(choices: debug, info, warn, error)`), and shell completion suggests
    matching values.  [[#281], [#688]]

 -  `zod()` now infers the metavar `"CHOICE"` instead of `"VALUE"` for
    `z.literal()` schemas with string values, and for `z.union()` schemas
    composed entirely of string literals.  [[#281], [#688]]

 -  `zod()` now validates the `metavar` option at runtime and throws
    a `TypeError` for empty strings.  Previously, an empty `metavar` would
    silently produce malformed help output.  [[#460], [#691]]

 -  `zod()` now throws a `TypeError` when an async Zod schema (e.g., async
    refinements) is used.  Previously, the raw Zod error was propagated
    unhandled.  [[#462], [#701]]

 -  `zod()` now formats transformed non-primitive values intelligently
    instead of producing `[object Object]`.  `Date` values use `.toISOString()`
    for stable output.  Plain objects use `JSON.stringify()`, while arrays
    use `String()` to preserve round-trip compatibility for common transforms.
    A new `format` option in `ZodParserOptions` allows custom formatting.
    [[#285], [#706]]

 -  `zod()` now uses CLI-friendly Boolean parsing for `z.boolean()` and
    `z.coerce.boolean()` schemas instead of JavaScript truthiness semantics.
    Accepted literals (case-insensitive): `true`/`false`, `1`/`0`, `yes`/`no`,
    `on`/`off`.  Recognized boolean schemas expose CLI-friendly completion
    metadata (`choices`/`suggest()`) when applicable.  [[#295], [#712]]

[#295]: https://github.com/dahlia/optique/issues/295
[#712]: https://github.com/dahlia/optique/pull/712


Version 0.10.7
--------------

Released on March 4, 2026.

### @optique/core

 -  Fixed `argument()` parser returning repeated suggestions after a value
    had already been consumed.  The `suggest()` method now returns an empty
    iterable when `context.state` is non-null (i.e., an argument has been
    parsed).  Additionally, `multiple()` now passes `parser.initialState`
    instead of the last consumed inner state when requesting suggestions from
    its inner parser, so that `multiple(argument(...))` continues to suggest
    remaining choices after the first value has been consumed.
    [[#133] by Ben van Enckevort]

[#133]: https://github.com/dahlia/optique/pull/133


Version 0.10.6
--------------

Released on February 20, 2026.

### @optique/core

 -  Fixed `runWith()` (and by extension `runWithConfig()`) crashing with
    `TypeError: Cannot read properties of undefined` when the top-level parser
    has an `undefined` initial state, such as `withDefault(object({...}))`.
    The root cause was that `injectAnnotationsIntoParser()` unconditionally
    spread `parser.initialState` into a new object with the annotation key,
    turning `undefined` into `{ [annotationKey]: annotations }`.  This corrupted
    the state for parsers like `withDefault()` and `optional()` that rely on
    `typeof state === "undefined"` to distinguish the uninitialized state from
    a wrapped inner state.  The fix skips annotation injection when the initial
    state is `null` or `undefined`.  The same guard was applied to annotation
    injection in `parseSync()`, `parseAsync()`, `suggestSync()`,
    `suggestAsync()`, and `getDocPage()`.  [[#131]]

 -  Fixed `formatDocPage()` to respect `maxWidth` when the rendered option
    term is wider than `termWidth` (default: 26).  Previously, the description
    column width was calculated assuming the term occupied exactly `termWidth`
    characters.  When the actual term was wider (e.g.,
    `-p, --package-manager PACKAGE_MANAGER` at 38 chars), the description
    column started further right on the first output line, but `formatMessage()`
    was still given the full `descColumnWidth` budget, allowing lines to exceed
    `maxWidth` by as much as the term's extra width.  The fix passes the extra
    width as `startWidth` to `formatMessage()` so the first-line budget is
    correctly narrowed.  The same correction is applied when appending default
    values (`showDefault`) and available choices (`showChoices`).  [[#132]]

 -  Fixed `formatDocPage()` to account for the closing suffix (`]` for default
    values, `)` for choices) when word-wrapping content.  Previously, the suffix
    was appended after `formatMessage()` had already filled the description
    column to capacity, producing lines that were one character too wide.

[#132]: https://github.com/dahlia/optique/issues/132


Version 0.10.5
--------------

Released on February 20, 2026.

### @optique/core

 -  Fixed meta options (`--help`, `--version`, `--completion`) being absent
    from both the usage line and the options list in the full help page, even
    though they appear correctly in the usage line shown above parse errors.
    The root cause was that `helpGeneratorParser`—the parser used to produce
    the help page—was built from the user's parser and any meta *commands*,
    but never included the meta *option* parsers (`helpOption`, `versionOption`,
    `completionOption`).  As a result, `getDocFragments()` was never called on
    those parsers, so their entries were silently omitted.  The fix adds the
    meta option parsers to the `commandParsers` list whenever the corresponding
    mode is `"option"` or `"both"`.  [[#127]]

 -  Fixed `formatDocPage()` to respect `maxWidth` when appending default values
    and available choices via `showDefault` and `showChoices`.  Previously,
    the appended text was concatenated onto the description string after
    word-wrapping had already been applied, with no awareness of how much of
    the current line was already occupied, so lines could far exceed `maxWidth`.
    [[#129]]

[#127]: https://github.com/dahlia/optique/issues/127
[#129]: https://github.com/dahlia/optique/issues/129


Version 0.10.4
--------------

Released on February 19, 2026.

### @optique/core

 -  Fixed `formatMessage()` to correctly handle a `lineBreak()` term that is
    immediately followed by a newline character in the source template literal.
    Previously, the newline after `${lineBreak()}` was normalized to a space
    (as single `\n` characters in text terms are), producing a spurious leading
    space at the start of the next line.  The newline immediately following a
    `lineBreak()` term is now dropped instead of being converted to a space.

 -  Fixed meta commands (`help`, `version`, `completion`, `completions`)
    disappearing from the subcommand list in help output when the parser uses
    a `withDefault(or(...))` construct.  The root cause was that
    `getDocPage()` used a `do...while` loop, which ran the parser at least
    once even with an empty argument buffer.  Because `withDefault(or(...))`
    allows the inner parser to succeed without consuming any tokens, the
    `longestMatch` combinator would record the user's parser as “selected”
    and subsequently return only that parser's doc fragments—silently
    dropping the meta command entries.  The loop is now a `while` loop that
    skips parsing entirely when the buffer is empty.  [[#121]]

[#121]: https://github.com/dahlia/optique/issues/121


Version 0.10.3
--------------

Released on February 18, 2026.

### @optique/core

 -  Fixed how `brief` and `description` are displayed in subcommand help
    pages.  [[#118], [#119]]

     -  Each help page now shows `brief` at the very top (before the Usage
        line) and `description` below the Usage line, consistent with how
        the root-level help page works.

     -  The `run()`-level `brief` and `description` no longer bleed into a
        subcommand's help page.  Previously, when a subcommand had no
        `description` of its own, the description supplied to `run()` would
        appear on the subcommand's help page (e.g. `repro file --help` would
        show “Description for repro CLI” even though that text describes the
        top-level program, not the `file` subcommand).  Now, only the
        subcommand's own `brief` and `description` (if any) are shown;
        run-level docs are used only for the root-level help page.

     -  When `command()` is wrapped with `group()`, the command's `brief`,
        `description`, and `footer` are now correctly forwarded to the help
        page.  Previously `group()` only forwarded `description`, so `brief`
        was silently dropped and the run-level brief appeared instead.

 -  Fixed contradictory “Did you mean?” suggestion when a subcommand name is
    provided at the wrong level.  Previously, a structure like
    `command("file", or(add, remove))` given the input `add --help` would
    report `Expected command file, but got add.` and then illogically suggest
    `Did you mean add?` even though `add` is only valid *inside* `file`.
    Suggestions in `command()` errors now derive from
    `extractLeadingCommandNames()`, which limits candidates to commands that
    are actually valid at the current parse position, not commands nested
    inside other commands.  The same scoping is applied when a custom
    `notMatched` callback receives its `suggestions` argument.  [[#117]]

 -  Fixed `group()` label leaking into a selected subcommand's own nested
    command list.  Previously, when a `group()`-wrapped command (e.g.,
    `alias`) itself contained further subcommands (e.g., `delete`, `set`),
    viewing `alias --help` would show those inner commands under the outer
    group's label (e.g., “Additional commands:”), which was incorrect.
    The fix compares current command entries against the initial set of
    commands that the group originally labeled; the label is now applied
    only when the visible commands are the group's own top-level commands,
    not commands from a deeper level.  [[#116]]

[#116]: https://github.com/dahlia/optique/issues/116
[#117]: https://github.com/dahlia/optique/issues/117
[#118]: https://github.com/dahlia/optique/issues/118
[#119]: https://github.com/dahlia/optique/issues/119


Version 0.10.2
--------------

Released on February 18, 2026.

### @optique/core

 -  Fixed `group()` incorrectly applying its label to subcommand flags
    in help output.  When `group()` wraps `command()` parsers (via `or()`),
    the group label is now only shown for the command list at the top level,
    not for the inner flags/options after a command is selected.  [[#114]]

 -  Fixed `merge()` not propagating `brief`, `description`, and `footer`
    from inner parsers in help output.  When using the
    `merge(or(...commands), globalOptions)` pattern, subcommand help
    (e.g., `myapp subcommand --help`) now correctly displays the command's
    description.  Previously, these fields were silently discarded by
    `merge()`.

[#114]: https://github.com/dahlia/optique/issues/114

### @optique/config

 -  Fixed `runWithConfig()` showing a raw `SyntaxError` stack trace when
    a config file contains malformed JSON.  It now prints a friendly error
    message that includes the file path.
    [[#109]]

[#109]: https://github.com/dahlia/optique/issues/109


Version 0.10.1
--------------

Released on February 17, 2026.

### @optique/core

 -  Fixed usage string collapsing to a single line when `completion` with
    `name: "both"` created a nested exclusive term (e.g.,
    `(completion | completions)`) inside an outer exclusive.
    `normalizeUsageTerm()` now distributes an exclusive that appears as the
    first term of a branch across the remaining terms, so that
    `[exclusive(A, B), C]` is flattened into separate branches `[A, C]` and
    `[B, C]`.  This allows `formatUsage()` with `expandCommands: true` to
    properly render each alternative on its own line.

### @optique/config

 -  Fixed `bindConfig()` usage rendering when `default` is provided. The
    generated usage term is now wrapped as optional, so usage strings correctly
    show the bound option in square brackets (`[]`).


Version 0.10.0
--------------

Released on February 15, 2026.

### @optique/core

 -  Added annotations system for passing runtime context to parsers. This allows
    parsers to access external runtime data during both `parse()` and
    `complete()` phases, enabling use cases like config file fallbacks,
    environment-based validation, and shared context. [[#83]]

    The annotations system uses symbol-keyed records to avoid naming conflicts
    between packages. Annotations are passed via the new `ParseOptions`
    parameter and can be accessed using the `getAnnotations()` helper function.

    New exports from `@optique/core/annotations`:

     -  `annotationKey`: Symbol for storing annotations in parser state.
     -  `Annotations`: Type for annotation records (symbol-keyed objects).
     -  `ParseOptions`: Options interface for parse functions.
     -  `getAnnotations()`: Helper function to extract annotations from state.

    Updated function signatures (all now accept optional `ParseOptions`):

     -  `parse()`, `parseSync()`, `parseAsync()`
     -  `suggest()`, `suggestSync()`, `suggestAsync()`
     -  `getDocPage()`, `getDocPageSync()`, `getDocPageAsync()`


    ~~~~ typescript
    import { parse, getAnnotations } from "@optique/core/parser";
    import { option } from "@optique/core/primitives";
    import { string } from "@optique/core/valueparser";

    // Define annotation key for your package
    const configDataKey = Symbol.for("@myapp/config");

    // Two-pass parsing with config file
    const firstPass = parse(parser, args);
    const configData = await loadConfig(firstPass.value.configPath);

    const finalResult = parse(parser, args, {
      annotations: {
        [configDataKey]: configData,
      },
    });

    // Access annotations in custom parser
    function myCustomParser() {
      return {
        // ... parser implementation
        complete: (state) => {
          const annotations = getAnnotations(state);
          const config = annotations?.[configDataKey];
          // Use config data for fallback values
        },
      };
    }
    ~~~~

    This is a backward-compatible change. Existing code continues to work
    unchanged as the `options` parameter is optional and annotations are only
    used when explicitly provided.

    See the [runtime context extension guide] for detailed documentation and
    usage patterns.

 -  Added `SourceContext` system and `runWith()` functions for composing
    multiple data sources with automatic priority handling. This builds on the
    annotations system to provide a higher-level abstraction for common
    use cases like environment variable fallbacks and config file loading.
    [[#85]]

    The source context system enables packages to provide data sources in a
    standard way with clear priority ordering. Earlier contexts in the array
    override later ones, making it natural to implement fallback chains like
    CLI > environment variables > configuration file > default values.

    New exports from `@optique/core/context`:

     -  `SourceContext`: Interface for data sources that provide annotations.
     -  `Annotations`: Re-exported from `@optique/core/annotations`.
     -  `isStaticContext()`: Helper to check if a context is static.

    New exports from `@optique/core/facade`:

     -  `runWith()`: Run parser with multiple source contexts (async).
     -  `runWithSync()`: Sync-only variant of `runWith()`.
     -  `runWithAsync()`: Explicit async variant of `runWith()`.

    The `runWith()` function uses a smart two-phase approach:

    1)  Collect annotations from all contexts (static return immediately,
        dynamic may return empty)
    2)  First parse with Phase 1 annotations
    3)  Call `getAnnotations(parsed)` on all contexts with parsed result
    4)  Second parse with merged annotations from both phases

    If all contexts are static, the second parse is skipped for optimization.

    The `runWith()` function ensures that help, version, and completion
    features always work, even when config files are missing or contexts
    would fail to load. Users can always access `--help`, `--version`, and
    completion without requiring a valid environment setup. [[#92]]

    ~~~~ typescript
    import { runWith } from "@optique/core/facade";
    import type { SourceContext } from "@optique/core/context";

    const envContext: SourceContext = {
      id: Symbol.for("@myapp/env"),
      getAnnotations() {
        return {
          [Symbol.for("@myapp/env")]: {
            HOST: process.env.MYAPP_HOST,
          }
        };
      }
    };

    const result = await runWith(
      parser,
      "myapp",
      [envContext],
      { args: process.argv.slice(2) }
    );
    ~~~~

 -  Added `url()` message component for displaying URLs with clickable
    hyperlinks in terminals that support OSC 8 escape sequences. URLs are
    validated using `URL.canParse()` and stored as `URL` objects internally.
    When colors are enabled, URLs are rendered with OSC 8 hyperlink sequences
    making them clickable in compatible terminals. When quotes are enabled,
    URLs are wrapped in angle brackets (`<>`).

    ~~~~ typescript
    import { message, url } from "@optique/core/message";

    const helpMsg = message`Visit ${url("https://example.com")} for details.`;
    ~~~~

    New exports:

     -  `url()`: Creates a URL message term from a string or URL object.
     -  `link()`: Alias for `url()`, useful for avoiding naming conflicts with
        the `url()` value parser from `@optique/core/valueparser`.

 -  Added `lineBreak()` message component for explicit single-line breaks in
    structured messages. Unlike single `\n` in `text()` terms (which are
    treated as soft breaks and rendered as spaces), `lineBreak()` always
    renders as a hard line break.

    ~~~~ typescript
    import { commandLine, lineBreak, message } from "@optique/core/message";

    const examples = message`Examples:${lineBreak()}
      Bash: ${commandLine(`eval "$(mycli completion bash)"`)}${lineBreak()}
      zsh:  ${commandLine(`eval "$(mycli completion zsh)"`)}`;
    ~~~~

 -  Added `@optique/core/program` module with `Program` and `ProgramMetadata`
    interfaces. These provide a structured way to bundle a parser with its
    metadata (name, version, description, etc.), creating a single source of
    truth for CLI application information. [[#82]]

    New exports:

     -  `Program<M, T>`: Interface bundling a parser with metadata.
     -  `ProgramMetadata`: Interface for program metadata including name,
        version, brief, description, author, bugs, examples, and footer.
     -  `defineProgram()`: Helper function for automatic type inference when
        creating `Program` objects. This eliminates the need to manually specify
        `Program<"sync", InferValue<typeof parser>>` type annotations.

 -  Added support for displaying `author`, `bugs`, and `examples` metadata
    fields in help text. When these fields are provided in `ProgramMetadata`
    or `RunOptions`, they are now displayed in the help output in the following
    order: Examples → Author → Bugs (before the footer). Each section has
    a bold label (when colors are enabled) and indented content for clear
    visual separation.

    ~~~~ typescript
    import { defineProgram } from "@optique/core/program";
    import { option } from "@optique/core/primitives";
    import { string } from "@optique/core/valueparser";
    import { message } from "@optique/core/message";

    const prog = defineProgram({
      parser: option("--name", string()),
      metadata: {
        name: "myapp",
        version: "1.0.0",
        brief: message`A sample CLI application`,
        description: message`This tool processes data efficiently.`,
        author: message`Jane Doe <jane@example.com>`,
      },
    });
    ~~~~

 -  Updated `runParser()` to accept `Program` objects directly. The new API
    automatically extracts program name and metadata from the `Program` object,
    eliminating the need to pass these separately. Both the new `Program`-based
    API and the original `parser`-based API are supported. [[#82]]

    ~~~~ typescript
    import { runParser } from "@optique/core/facade";

    // Program-based API (recommended for applications with metadata)
    const result = runParser(prog, ["--name", "Alice"]);

    // Parser-based API (useful for simple scripts)
    const result = runParser(parser, "myapp", ["--name", "Alice"], {
      brief: message`A sample CLI application`,
      // ...
    });
    ~~~~

 -  Added inter-option dependency support via `@optique/core/dependency` module.
    This allows one option's valid values to depend on another option's parsed
    value, enabling dynamic validation and context-aware shell completion.
    [[#74], [#76]]

    New exports:

     -  `dependency()`: Creates a dependency source from an existing value parser.
     -  `deriveFrom()`: Creates a derived parser from multiple dependency sources.
     -  `DependencySource<M, T>`: A value parser that can be referenced by other
        parsers.
     -  `DerivedValueParser<M, T>`: A value parser whose behavior depends on
        other parsers' values.

    The dependency system uses deferred parsing: dependent options store their
    raw input during initial parsing, then re-validate using actual dependency
    values after all options are collected.

    ~~~~ typescript
    import { dependency } from "@optique/core/dependency";
    import { choice } from "@optique/core/valueparser";

    // Create a dependency source
    const modeParser = dependency(choice(["dev", "prod"] as const));

    // Create a derived parser that depends on the mode
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode) => {
        if (mode === "dev") {
          return choice(["debug", "info", "warn", "error"]);
        } else {
          return choice(["warn", "error"]);
        }
      },
      defaultValue: () => "dev" as const,
    });
    ~~~~

    Dependencies work seamlessly with all parser combinators (`object()`,
    `subcommands()`, `or()`, `longestMatch()`, `multiple()`, etc.) and support
    both sync and async parsers.

 -  Added `nonEmpty()` modifier that requires the wrapped parser to consume at
    least one input token to succeed.  This enables conditional default values
    and help display logic when using `longestMatch()`.  [[#79], [#80]]

    ~~~~ typescript
    import { longestMatch, object } from "@optique/core/constructs";
    import { nonEmpty, optional, withDefault } from "@optique/core/modifiers";
    import { constant, option } from "@optique/core/primitives";
    import { string } from "@optique/core/valueparser";

    // Without nonEmpty(): activeParser always wins (consumes 0 tokens)
    // With nonEmpty(): helpParser wins when no options are provided
    const activeParser = nonEmpty(object({
      mode: constant("active" as const),
      cwd: withDefault(option("--cwd", string()), "./default"),
      key: optional(option("--key", string())),
    }));

    const helpParser = object({ mode: constant("help" as const) });
    const parser = longestMatch(activeParser, helpParser);
    ~~~~

 -  Added `port()` value parser for TCP/UDP port numbers with support for both
    `number` and `bigint` types, range validation, and well-known port
    restrictions. The parser validates port numbers (1–65535 by default) and
    optionally enforces custom ranges or disallows well-known ports (1–1023).
    [[#89]]

    ~~~~ typescript
    import { option } from "@optique/core/primitives";
    import { port } from "@optique/core/valueparser";

    // Basic port parser (1-65535)
    option("--port", port())

    // Non-privileged ports only
    option("--port", port({ min: 1024, max: 65535 }))

    // Disallow well-known ports
    option("--port", port({ disallowWellKnown: true }))

    // Using bigint type
    option("--port", port({ type: "bigint" }))
    ~~~~

 -  Added `ipv4()` value parser for IPv4 address validation with filtering
    options for private, loopback, link-local, multicast, broadcast, and zero
    addresses. The parser validates IPv4 addresses in dotted-decimal notation
    (e.g., “192.168.1.1”) and provides fine-grained control over which address
    types are accepted. [[#89]]

    ~~~~ typescript
    import { option } from "@optique/core/primitives";
    import { ipv4 } from "@optique/core/valueparser";

    // Basic IPv4 parser (allows all types)
    option("--ip", ipv4())

    // Public IPs only (no private/loopback)
    option("--public-ip", ipv4({
      allowPrivate: false,
      allowLoopback: false
    }))

    // Server binding address
    option("--bind", ipv4({
      allowZero: true,
      allowPrivate: true
    }))
    ~~~~

 -  Added `hostname()` value parser for DNS hostname validation with support
    for wildcards, underscores, localhost filtering, and length constraints.
    The parser validates hostnames according to RFC 1123 with configurable
    options for special cases like service discovery records and SSL certificate
    domains. [[#89]]

    ~~~~ typescript
    import { option } from "@optique/core/primitives";
    import { hostname } from "@optique/core/valueparser";

    // Basic hostname parser
    option("--host", hostname())

    // Allow wildcards for SSL certificates
    option("--domain", hostname({ allowWildcard: true }))

    // Reject localhost for remote connections
    option("--remote", hostname({ allowLocalhost: false }))

    // Service discovery records (allow underscores)
    option("--srv", hostname({ allowUnderscore: true }))
    ~~~~

 -  Added `email()` value parser for email address validation with support for
    display names, multiple addresses, domain filtering, and quoted local parts.
    The parser validates email addresses according to simplified RFC 5322
    addr-spec format with practical defaults for common use cases. [[#89]]

    ~~~~ typescript
    import { option } from "@optique/core/primitives";
    import { email } from "@optique/core/valueparser";

    // Basic email parser
    option("--email", email())

    // Multiple email addresses
    option("--to", email({ allowMultiple: true }))

    // Allow display names
    option("--from", email({ allowDisplayName: true }))

    // Restrict to company domains
    option("--work-email", email({ allowedDomains: ["company.com"] }))

    // Convert to lowercase
    option("--email", email({ lowercase: true }))
    ~~~~

 -  Added `socketAddress()` value parser for socket addresses in “host:port”
    format. The parser validates both hostname and IPv4 addresses combined with
    port numbers, with support for default ports, custom separators, and host
    type filtering. Returns a `SocketAddressValue` object containing both host
    and port. [[#89]]

    ~~~~ typescript
    import { option } from "@optique/core/primitives";
    import { socketAddress } from "@optique/core/valueparser";

    // Basic socket address (requires port)
    option("--endpoint", socketAddress({ requirePort: true }))

    // With default port
    option("--server", socketAddress({ defaultPort: 80 }))

    // IP addresses only
    option("--bind", socketAddress({
      defaultPort: 8080,
      host: { type: "ip" }
    }))

    // Non-privileged ports only
    option("--listen", socketAddress({
      defaultPort: 8080,
      port: { min: 1024 }
    }))
    ~~~~

 -  Added `portRange()` value parser for port ranges (e.g., “8000-8080”). The
    parser validates port ranges with support for both `number` and `bigint`
    types, custom separators, single port mode, and min/max constraints.
    Returns a `PortRangeValue` object containing `start` and `end` ports.
    [[#89]]

    ~~~~ typescript
    import { option } from "@optique/core/primitives";
    import { portRange } from "@optique/core/valueparser";

    // Basic port range
    option("--ports", portRange())

    // Allow single port (returns range with start === end)
    option("--ports", portRange({ allowSingle: true }))

    // Custom separator
    option("--ports", portRange({ separator: ":" }))

    // Non-privileged ports only
    option("--ports", portRange({ min: 1024 }))

    // Using bigint type
    option("--ports", portRange({ type: "bigint" }))
    ~~~~

 -  Added `macAddress()` value parser for MAC (Media Access Control)
    addresses. The parser validates MAC-48 addresses in multiple formats
    (colon-separated, hyphen-separated, Cisco dot notation, or no separator)
    with support for case conversion and output normalization. Returns a
    formatted string. [[#89]]

    ~~~~ typescript
    import { option } from "@optique/core/primitives";
    import { macAddress } from "@optique/core/valueparser";

    // Accept any format
    option("--mac", macAddress())

    // Normalize to uppercase colon-separated
    option("--mac", macAddress({
      outputSeparator: ":",
      case: "upper"
    }))

    // Cisco format only
    option("--mac", macAddress({
      separator: ".",
      case: "lower"
    }))
    ~~~~

 -  Added `domain()` value parser for domain name validation. The parser
    validates domain names according to RFC 1035 with configurable options for
    subdomain filtering, TLD restrictions, minimum label requirements, and case
    normalization. Returns a formatted string. [[#89]]

    ~~~~ typescript
    import { option } from "@optique/core/primitives";
    import { domain } from "@optique/core/valueparser";

    // Accept any valid domain
    option("--domain", domain())

    // Root domains only (no subdomains)
    option("--root", domain({ allowSubdomains: false }))

    // Restrict to specific TLDs
    option("--domain", domain({ allowedTLDs: ["com", "org", "net"] }))

    // Normalize to lowercase
    option("--domain", domain({ lowercase: true }))
    ~~~~

 -  Added `ipv6()` value parser for IPv6 address validation. The parser
    validates and normalizes IPv6 addresses to canonical form (lowercase,
    compressed using `::` notation) with support for full addresses, compressed
    notation, and IPv4-mapped IPv6 addresses. Configurable address type
    restrictions for loopback, link-local, unique local, multicast, and zero
    addresses. Returns a normalized string. [[#89]]

    ~~~~ typescript
    import { option } from "@optique/core/primitives";
    import { ipv6 } from "@optique/core/valueparser";

    // Accept any IPv6 address
    option("--ipv6", ipv6())

    // Global unicast only (no link-local, no unique local)
    option("--public-ipv6", ipv6({
      allowLinkLocal: false,
      allowUniqueLocal: false
    }))

    // No loopback addresses
    option("--ipv6", ipv6({ allowLoopback: false }))
    ~~~~

 -  Added `ip()` value parser that accepts both IPv4 and IPv6 addresses. The
    parser can be configured to accept only IPv4, only IPv6, or both (default).
    Delegates to `ipv4()` and `ipv6()` parsers based on version setting, with
    intelligent error handling that preserves specific validation errors.
    Returns a normalized IP address string. [[#89]]

    ~~~~ typescript
    import { option } from "@optique/core/primitives";
    import { ip } from "@optique/core/valueparser";

    // Accept both IPv4 and IPv6
    option("--ip", ip())

    // IPv4 only
    option("--ipv4", ip({ version: 4 }))

    // Public IPs only (both versions)
    option("--public-ip", ip({
      ipv4: { allowPrivate: false, allowLoopback: false },
      ipv6: { allowLinkLocal: false, allowUniqueLocal: false }
    }))
    ~~~~

 -  Added `cidr()` value parser for CIDR notation validation. The parser
    validates CIDR notation like `192.168.0.0/24` or `2001:db8::/32` and
    returns a structured object with the normalized IP address, prefix length,
    and IP version. Supports prefix length constraints and delegates IP
    validation to `ipv4()` and `ipv6()` parsers. [[#89]]

    ~~~~ typescript
    import { option } from "@optique/core/primitives";
    import { cidr } from "@optique/core/valueparser";

    // Accept both IPv4 and IPv6 CIDR
    option("--network", cidr())

    // IPv4 CIDR only with prefix constraints
    option("--subnet", cidr({
      version: 4,
      minPrefix: 16,
      maxPrefix: 24
    }))
    ~~~~

 -  Removed deprecated `run` export. Use `runParser()` instead. The old name
    was deprecated in v0.9.0 due to naming conflicts with `@optique/run`'s
    `run()` function. [[#65]]

 -  Removed deprecated `RunError` export. Use `RunParserError` instead.
    This was renamed in v0.9.0 for consistency with the `runParser()` rename.
    [[#65]]

 -  Added `helpVisibility` to completion configuration in `runParser()` and
    `runWith*()` APIs. This allows keeping both singular and plural completion
    aliases enabled at runtime while controlling whether help shows singular,
    plural, both, or none of the completion entries. Type definitions now
    enforce valid `name` and `helpVisibility` combinations at compile time.
    [[#99]]

 -  Added `showChoices` option to `formatDocPage()` and `runParser()` for
    displaying valid choices in help output.  When enabled, options and
    arguments backed by `choice()` value parsers automatically show their
    valid values in help text, similar to the existing `showDefault` feature.
    [[#106]]

    ~~~~ typescript
    import { runParser } from "@optique/core/facade";

    // Basic usage — shows "(choices: json, yaml, xml)"
    runParser(parser, "myapp", args, { showChoices: true });

    // Custom format — shows "{json | yaml | xml}"
    runParser(parser, "myapp", args, {
      showChoices: { prefix: " {", suffix: "}", label: "" },
    });
    ~~~~

    New APIs:

     -  `ValueParser.choices`: Optional array of valid choices, populated
        automatically by the `choice()` function.
     -  `DocEntry.choices`: Formatted choices as a `Message` for help rendering.
     -  `ShowChoicesOptions`: Interface for customizing choices display
        (prefix, suffix, label, maxItems).
     -  `DocPageFormatOptions.showChoices`: Enables choices display in
        formatted help output.
     -  `RunOptions.showChoices`: Passes through to `formatDocPage()`.

 -  Added `group` option for meta-commands (help, version, completion) in
    `RunOptions`.  When specified, the meta-command appears under a titled
    section in help output instead of alongside user-defined commands.
    Commands sharing the same group name are merged into a single section.
    [[#107]]

    The `group` option is only available when the meta-command has a command
    mode (`"command"` or `"both"`).  When the mode is `"option"`, the `group`
    option is blocked at the type level (`group?: never`).

    ~~~~ typescript
    import { runParser } from "@optique/core/facade";

    runParser(parser, "myapp", args, {
      help: { mode: "both", group: "Other" },
      version: { mode: "both", value: "1.0.0", group: "Other" },
      completion: { mode: "both", group: "Other" },
    });
    ~~~~

[runtime context extension guide]: https://optique.dev/concepts/extend
[#65]: https://github.com/dahlia/optique/issues/65
[#74]: https://github.com/dahlia/optique/issues/74
[#76]: https://github.com/dahlia/optique/pull/76
[#79]: https://github.com/dahlia/optique/issues/79
[#80]: https://github.com/dahlia/optique/pull/80
[#82]: https://github.com/dahlia/optique/issues/82
[#83]: https://github.com/dahlia/optique/issues/83
[#85]: https://github.com/dahlia/optique/issues/85
[#89]: https://github.com/dahlia/optique/issues/89
[#92]: https://github.com/dahlia/optique/issues/92
[#99]: https://github.com/dahlia/optique/issues/99
[#106]: https://github.com/dahlia/optique/issues/106
[#107]: https://github.com/dahlia/optique/issues/107

### @optique/config

The *@optique/config* package was introduced in this release, providing
configuration file support with type-safe validation using [Standard Schema].
[[#84], [#90]]

 -  Added `createConfigContext()` function for creating configuration contexts
    with Standard Schema validation.

 -  Added `bindConfig()` function to bind parsers to configuration values with
    automatic fallback handling.

 -  Added `runWithConfig()` function for running parsers with two-pass parsing
    to load and validate configuration files. The function delegates to
    `runWith()` internally, automatically providing help, version, and shell
    completion support. These features work even when config files are missing
    or invalid, ensuring users can always access help documentation. [[#93]]

 -  Added `ConfigContext` interface implementing `SourceContext` for composable
    data source integration.

 -  Added `configKey` symbol for storing config data in annotations.

 -  Added `SingleFileOptions` interface for single-file config loading with
    optional `fileParser` for custom file formats.

 -  Added `CustomLoadOptions` interface with `load` callback for multi-file
    merging scenarios (system, user, project config cascading).

 -  `RunWithConfigOptions` is a discriminated union of `SingleFileOptions`
    and `CustomLoadOptions`.

The package uses a two-phase parsing approach to ensure proper priority
(CLI > config file > default values). See the [config file integration guide]
for usage examples.

[Standard Schema]: https://standardschema.dev/
[config file integration guide]: https://optique.dev/integrations/config
[#84]: https://github.com/dahlia/optique/issues/84
[#90]: https://github.com/dahlia/optique/issues/90
[#93]: https://github.com/dahlia/optique/issues/93

### @optique/run

 -  Added `contexts` option to `run()`, `runSync()`, and `runAsync()` for
    source context support.  When provided, the runner delegates to
    `runWith()` (or `runWithSync()`) from `@optique/core/facade`, which
    handles annotation collection, two-phase parsing, and context disposal
    automatically.  Context-specific options (e.g., `getConfigPath`, `load`)
    are passed through alongside the standard runner options.  [[#110]]

    ~~~~ typescript
    import { runAsync } from "@optique/run";

    const result = await runAsync(parser, {
      contexts: [configContext],
      getConfigPath: (parsed) => parsed.config,
      help: "both",
    });
    ~~~~

 -  Updated `run()`, `runSync()`, and `runAsync()` to accept `Program` objects
    directly. The new API automatically extracts program name and metadata from
    the `Program` object. Both the new `Program`-based API and the original
    `parser`-based API are supported. [[#82]]

    ~~~~ typescript
    import { run } from "@optique/run";

    // Program-based API (recommended for applications with metadata)
    const result = run(prog, {
      help: "both",
      colors: true,
    });

    // Parser-based API (useful for simple scripts)
    const result = run(parser, {
      programName: "myapp",
      help: "both",
      colors: true,
      brief: message`A sample CLI application`,
      // ...
    });
    ~~~~

 -  Added `completion.helpVisibility` to `run()` options. This controls whether
    completion aliases are shown in help and usage output (`"singular"`,
    `"plural"`, `"both"`, or `"none"`) independently from which aliases are
    accepted at runtime via `completion.name`. [[#99]]

 -  Added `showChoices` option to `run()`, `runSync()`, and `runAsync()`.
    This passes through to the underlying `formatDocPage()` call, enabling
    valid choice values to be displayed in help output.  [[#106]]

 -  Added `group` option for help, version, and completion configurations.
    When specified, the corresponding meta-command appears under a titled
    section in help output.  The `group` option is available when the mode
    is `"command"` or `"both"` (blocked at the type level for `"option"` mode).
    [[#107]]

    ~~~~ typescript
    import { run } from "@optique/run";

    run(parser, {
      help: { mode: "both", group: "Other" },
      version: { value: "1.0.0", mode: "both", group: "Other" },
      completion: { mode: "both", group: "Other" },
    });
    ~~~~

### @optique/man

The *@optique/man* package was introduced in this release, providing
man page generation from parser metadata.  This allows CLI applications
to generate Unix man pages that stay synchronized with parser definitions.
[[#77]]

 -  Added `generateManPage()` function for generating man pages from sync
    parsers.

 -  Added `generateManPageSync()` function for explicit sync-only man page
    generation.

 -  Added `generateManPageAsync()` function for generating man pages from
    async parsers.

 -  Added `ManPageOptions` interface for configuring man page output (name,
    section, description, date, source, manual, authors, seeAlso, bugs).

 -  Added `formatDocPageAsMan()` function for converting `DocPage` objects
    to man page format.

 -  Added `formatMessageAsRoff()` function for converting Optique `Message`
    objects to roff markup.

 -  Added `escapeRoff()` function for escaping special roff characters.

 -  Added `escapeHyphens()` function for escaping hyphens in option names.

 -  Updated `generateManPage()`, `generateManPageSync()`, and
    `generateManPageAsync()` to accept `Program` objects directly.
    The metadata (`name`, `version`, `author`, `bugs`, `examples`) is
    automatically extracted from the program, eliminating duplication.
    [[#82]]

    ~~~~ typescript
    import { defineProgram } from "@optique/core/program";
    import { generateManPage } from "@optique/man";

    const prog = defineProgram({
      parser: myParser,
      metadata: {
        name: "myapp",
        version: "1.0.0",
        author: message`Hong Minhee`,
      },
    });

    // Metadata is automatically extracted
    const manPage = generateManPage(prog, { section: 1 });
    ~~~~

 -  Added `optique-man` CLI tool for generating man pages from TypeScript/JavaScript
    files that export a `Program` or `Parser`.  This enables automated man page
    generation as part of build processes.  [[#77]]

    ~~~~ bash
    # Generate man page from a Program export
    optique-man ./src/cli.ts -s 1

    # Use a named export instead of default
    optique-man ./src/cli.ts -s 1 -e myProgram

    # Write output to a file
    optique-man ./src/cli.ts -s 1 -o myapp.1
    ~~~~

    The CLI supports:

     -  Loading TypeScript files directly (Deno, Bun, Node.js 25.2.0+ native,
        or Node.js with `tsx` installed).
     -  Extracting metadata from `Program` objects or using command-line options
        for `Parser` objects.
     -  Overriding metadata via `--name`, `--date`, `--version-string`, and
        `--manual` options.

[#77]: https://github.com/dahlia/optique/issues/77


Version 0.9.10
--------------

Released on February 19, 2026.

### @optique/core

 -  Fixed meta commands (`help`, `version`, `completion`, `completions`)
    disappearing from the subcommand list in help output when the parser uses
    a `withDefault(or(...))` construct.  The root cause was that
    `getDocPage()` used a `do...while` loop, which ran the parser at least
    once even with an empty argument buffer.  Because `withDefault(or(...))`
    allows the inner parser to succeed without consuming any tokens, the
    `longestMatch` combinator would record the user's parser as “selected”
    and subsequently return only that parser's doc fragments—silently
    dropping the meta command entries.  The loop is now a `while` loop that
    skips parsing entirely when the buffer is empty.  [[#121]]


Version 0.9.9
-------------

Released on February 18, 2026.

### @optique/core

 -  Fixed how `brief` and `description` are displayed in subcommand help
    pages.  [[#118], [#119]]

     -  Each help page now shows `brief` at the very top (before the Usage
        line) and `description` below the Usage line, consistent with how
        the root-level help page works.

     -  The `run()`-level `brief` and `description` no longer bleed into a
        subcommand's help page.  Previously, when a subcommand had no
        `description` of its own, the description supplied to `run()` would
        appear on the subcommand's help page (e.g. `repro file --help` would
        show “Description for repro CLI” even though that text describes the
        top-level program, not the `file` subcommand).  Now, only the
        subcommand's own `brief` and `description` (if any) are shown;
        run-level docs are used only for the root-level help page.

     -  When `command()` is wrapped with `group()`, the command's `brief`,
        `description`, and `footer` are now correctly forwarded to the help
        page.  Previously `group()` only forwarded `description`, so `brief`
        was silently dropped and the run-level brief appeared instead.

 -  Fixed contradictory “Did you mean?” suggestion when a subcommand name is
    provided at the wrong level.  Previously, a structure like
    `command("file", or(add, remove))` given the input `add --help` would
    report `Expected command file, but got add.` and then illogically suggest
    `Did you mean add?` even though `add` is only valid *inside* `file`.
    Suggestions in `command()` errors now derive from
    `extractLeadingCommandNames()`, which limits candidates to commands that
    are actually valid at the current parse position, not commands nested
    inside other commands.  The same scoping is applied when a custom
    `notMatched` callback receives its `suggestions` argument.  [[#117]]

 -  Fixed `group()` label leaking into a selected subcommand's own nested
    command list.  Previously, when a `group()`-wrapped command (e.g.,
    `alias`) itself contained further subcommands (e.g., `delete`, `set`),
    viewing `alias --help` would show those inner commands under the outer
    group's label (e.g., “Additional commands:”), which was incorrect.
    The fix compares current command entries against the initial set of
    commands that the group originally labeled; the label is now applied
    only when the visible commands are the group's own top-level commands,
    not commands from a deeper level.  [[#116]]


Version 0.9.8
-------------

Released on February 18, 2026.

### @optique/core

 -  Fixed `group()` incorrectly applying its label to subcommand flags
    in help output.  When `group()` wraps `command()` parsers (via `or()`),
    the group label is now only shown for the command list at the top level,
    not for the inner flags/options after a command is selected.  [[#114]]

 -  Fixed `merge()` not propagating `brief`, `description`, and `footer`
    from inner parsers in help output.  When using the
    `merge(or(...commands), globalOptions)` pattern, subcommand help
    (e.g., `myapp subcommand --help`) now correctly displays the command's
    description.  Previously, these fields were silently discarded by
    `merge()`.


Version 0.9.7
-------------

Released on February 17, 2026.

### @optique/core

 -  Fixed usage string collapsing to a single line when `completion` with
    `name: "both"` created a nested exclusive term (e.g.,
    `(completion | completions)`) inside an outer exclusive.
    `normalizeUsageTerm()` now distributes an exclusive that appears as the
    first term of a branch across the remaining terms, so that
    `[exclusive(A, B), C]` is flattened into separate branches `[A, C]` and
    `[B, C]`.  This allows `formatUsage()` with `expandCommands: true` to
    properly render each alternative on its own line.


Version 0.9.6
-------------

Released on February 14, 2026.

### @optique/core

 -  Fixed the `completion` command appearing before user-defined commands in
    the usage line shown on parse errors.  When using `completion` in command
    mode with `or()`-combined commands, the error output now lists user commands
    first and meta-commands (version, completion, help) after them.  [[#107]]


Version 0.9.5
-------------

Released on February 13, 2026.

### @optique/core

 -  Fixed contradictory suggestion messages for subcommand-only options at the
    root command level.  Previously, when an option that belongs to a
    subcommand was entered before specifying the subcommand (for example,
    `mycli --fooflag 123` where `--fooflag` belongs to `mycli foo`), the parser
    could report `Unexpected option or subcommand` and still suggest the same
    option.  Suggestions now only include options and commands that are valid at
    the current parse position.  [[#98]]

 -  Fixed `--completion` and `--completions` without a shell value in option
    mode reporting a generic parse error.  Previously, inputs like
    `mycli --completion` could fall through to normal argument parsing and show
    `Unexpected option or subcommand`, which was misleading.  These now produce
    the dedicated completion error for a missing shell name.  [[#100]]

[#98]: https://github.com/dahlia/optique/issues/98
[#100]: https://github.com/dahlia/optique/issues/100


Version 0.9.4
-------------

Released on February 12, 2026.

### @optique/core

 -  Fixed `mycli subcommand --help` displaying the `brief` and `description`
    passed to `run()` instead of those passed to `command()`.  Now, when
    showing help for a specific subcommand, the subcommand's own `brief`,
    `description`, and `footer` take priority over the `run()`-level values.
    The `run()`-level values are used as fallback only when the subcommand
    does not define its own.  [[#95]]

[#95]: https://github.com/dahlia/optique/issues/95


Version 0.9.3
-------------

Released on February 12, 2026.

### @optique/core

 -  Fixed `run()` showing top-level help instead of an error when `--help`
    is used with an invalid subcommand (e.g., `mycli nonexistent --help`).
    Previously, the help handler did not validate whether the commands
    extracted before `--help` were actually recognized by the parser,
    so it silently fell back to displaying root-level help.  Now, the
    commands are validated against the parser, and an appropriate error
    message with usage information is shown instead.  [[#97]]
 -  Fixed nested subcommand help showing sibling subcommand usage lines.
    Previously, when using `or(topLevel, command("nested", or(foo, bar)))`,
    running `mycli nested foo --help` would incorrectly display usage lines
    for both `foo` and `bar` subcommands.  Now, only the selected subcommand's
    usage is shown.  [[#96]]

[#96]: https://github.com/dahlia/optique/issues/96
[#97]: https://github.com/dahlia/optique/issues/97


Version 0.9.2
-------------

Released on January 30, 2026.

### @optique/core

 -  Fixed `command()` with `hidden: true` incorrectly hiding inner
    argument/option descriptions when the hidden command is matched and
    executed.  Previously, when a hidden command was invoked with `--help`,
    the help text would not show descriptions for the command's arguments
    and options, even when those arguments and options were not hidden.
    Now, the `hidden` option only applies when the command is shown in a
    command list (when the command is not matched), and inner parser
    documentation is displayed normally when the hidden command is actually
    executed.  [[#88]]

 -  Fixed `formatUsage()` incorrectly showing hidden commands in expanded
    usage lines.  Previously, when using `expandCommands: true` option,
    hidden commands would appear in the usage output even though they were
    correctly excluded from the command list.  Now, hidden commands are
    filtered out from expanded usage lines while remaining fully functional
    for parsing.

[#88]: https://github.com/dahlia/optique/issues/88


Version 0.9.1
-------------

Released on January 19, 2026.

### @optique/core

 -  Fixed `command()` failing to parse inner parser when buffer is empty after
    command match.  Previously, when using `command()` with an inner parser
    that can succeed with zero tokens (like `longestMatch()` or `object()` with
    all optional fields), parsing `["dev"]` would fail with “No matching option,
    command, or argument found” even though the inner parser should succeed.
    Now, the `complete()` method first gives the inner parser a chance to run
    with an empty buffer before completing.  [[#81]]

[#81]: https://github.com/dahlia/optique/issues/81


Version 0.9.0
-------------

Released on January 6, 2026.

### @optique/core

 -  Added sync/async mode support to `Parser` and `ValueParser` interfaces.
    The new `M extends Mode = "sync"` type parameter enables type-safe
    distinction between synchronous and asynchronous parsers.  [[#52], [#70]]

    New types:

     -  `Mode`: Type alias for `"sync" | "async"`.
     -  `ModeValue<M, T>`: Returns `T` for sync mode, `Promise<T>` for async.
     -  `ModeIterable<M, T>`: Returns `Iterable<T>` for sync, `AsyncIterable<T>`
        for async.
     -  `CombineModes<T extends readonly Mode[]>`: Returns `"async"` if any
        element is `"async"`, otherwise `"sync"`.
     -  `InferMode<P>`: Extracts the mode from a parser type.

    All parsers now include a `$mode` property indicating their execution mode.
    Combinators automatically propagate modes from their constituent parsers,
    resulting in `"async"` mode if any child parser is async.

    New functions for explicit mode handling:

     -  `parseSync()`: Parses with a sync-only parser, returning directly.
     -  `parseAsync()`: Parses with any parser, returning a Promise.
     -  `suggestSync()`: Gets suggestions from a sync-only parser.
     -  `suggestAsync()`: Gets suggestions from any parser as a Promise.
     -  `getDocPageSync()`: Gets documentation page from a sync-only parser.
     -  `getDocPageAsync()`: Gets documentation page from any parser as a Promise.
     -  `runParserSync()`: Runs a sync-only parser, returning the result directly.
     -  `runParserAsync()`: Runs any parser, returning a Promise of the result.

    This change is backward compatible.  Existing code continues to work
    unchanged as all parsers default to sync mode.

    ~~~~ typescript
    import type { ValueParser } from "@optique/core/valueparser";
    import { integer } from "@optique/core/valueparser";
    import { parseSync, parseAsync } from "@optique/core/parser";

    const args: readonly string[] = ["42"];

    // Sync parser (default)
    const syncParser: ValueParser<"sync", number> = integer();

    // Custom async parser
    const asyncParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "REMOTE",
      async parse(input) {
        const data = await fetch(input);
        return { success: true, value: await data.text() };
      },
      format: (v) => v,
    };

    // Type-safe parsing
    const syncResult = parseSync(syncParser, args);        // Returns directly
    const asyncResult = await parseAsync(asyncParser, args); // Returns Promise
    ~~~~

 -  Fixed a shell command injection vulnerability in the shell
    completion script generators. The `programName` parameter in shell
    completion generators (`bash`, `zsh`, `fish`, `nu`, `pwsh`) was directly
    interpolated into shell scripts without validation, which could allow
    arbitrary command execution if an attacker-controlled program name was used.

    The fix adds strict validation of program names, allowing only alphanumeric
    characters, underscores, hyphens, and dots. Programs with names containing
    shell metacharacters or other special characters will now throw an error
    when generating completion scripts.

 -  Added documentation warning about potential Regular Expression Denial of
    Service (ReDoS) attacks when using the `pattern` option in `string()` value
    parser. Users providing custom patterns should be aware that maliciously
    crafted input can cause exponential backtracking in vulnerable patterns.
    The documentation recommends avoiding patterns with nested quantifiers and
    suggests using tools like *safe-regex* to validate patterns before use.

 -  Renamed `run()` function to `runParser()` to avoid naming conflict with
    `@optique/run`'s `run()` function.  IDE autocomplete was suggesting both
    functions when typing `run`, causing confusion.  The old `run()` export
    is still available but deprecated and will be removed in a future major
    version.  [[#54]]

 -  Renamed `RunError` class to `RunParserError` for consistency with the
    `runParser()` rename.  The old `RunError` export is still available but
    deprecated and will be removed in a future major version.  [[#54]]

 -  Added support for `optional()` and `withDefault()` wrappers inside `merge()`.
    Previously, `merge(optional(or(...)), object({...}))` would fail when the
    optional parser didn't match any input.  Now, parsers that succeed without
    consuming input (like `optional()` when nothing matches) are handled
    correctly, allowing the next parser in the merge to process remaining
    arguments.  [[#57]]

    ~~~~ typescript
    // Now works correctly
    const parser = merge(
      optional(
        or(
          object({ verbosity: map(multiple(flag("-v")), v => v.length) }),
          object({ verbosity: map(flag("-q"), () => 0) }),
        ),
      ),
      object({ file: argument(string()) }),
    );

    // myapp file.txt         → { file: "file.txt" }
    // myapp -v -v file.txt   → { verbosity: 2, file: "file.txt" }
    ~~~~

 -  Added `hidden` option to all primitive parsers (`option()`, `flag()`,
    `argument()`, `command()`, `passThrough()`).  When `hidden: true`, the
    parser is excluded from help text, shell completion suggestions, and
    “Did you mean?” error suggestions, while remaining fully functional for
    parsing.  This is useful for deprecated options, internal debugging flags,
    and experimental features.  [[#62]]

    ~~~~ typescript
    // Deprecated option: still works, but not shown in help
    const parser = object({
      output: option("-o", "--output", string()),
      outputLegacy: option("--out", string(), { hidden: true }),
    });

    // Internal debugging flag
    const debug = flag("--trace-internal", { hidden: true });
    ~~~~

 -  Added compile-time and runtime validation for `metavar` to reject empty
    strings.  The `metavar` property in `ValueParser` and related option
    interfaces now uses a non-empty string type (`NonEmptyString`), providing
    TypeScript errors when an empty string literal is passed.  Additionally,
    value parser factory functions (`string()`, `integer()`, `float()`,
    `choice()`, `url()`, `locale()`, `uuid()`) now throw a `TypeError` at
    runtime if an empty `metavar` is provided.  [[#63]]

     -  Added `@optique/core/nonempty` module.
     -  Added `NonEmptyString` type.
     -  Added `isNonEmptyString()` type guard function.
     -  Added `ensureNonEmptyString()` assertion function.

 -  Extended `choice()` value parser to support number literals in addition to
    strings.  This enables type-safe enumeration of numeric values like bit
    depths, port numbers, or other numeric options where only specific values
    are valid.  [[#64]]

    ~~~~ typescript
    // Bit depth choice - returns ValueParser<8 | 10 | 12>
    const bitDepth = choice([8, 10, 12]);

    // Port selection
    const port = choice([80, 443, 8080]);
    ~~~~

    The implementation uses function overloads to provide proper type inference
    for both string and number choices.  The `caseInsensitive` option remains
    available only for string choices, enforced at the type level.

     -  Added `ChoiceOptionsBase` interface.
     -  Added `ChoiceOptionsString` interface.
     -  Added `ChoiceOptionsNumber` interface.
     -  Deprecated `ChoiceOptions` interface in favor of `ChoiceOptionsString`.

 -  Added `valueSet()` function for formatting choice lists with locale-aware
    separators.  This function uses `Intl.ListFormat` to format lists according
    to locale conventions with appropriate conjunctions like “and” or
    “or”, making it suitable for error messages in `choice()` value parsers
    and similar contexts.

    ~~~~ typescript
    import { message, valueSet } from "@optique/core/message";

    const choices = ["error", "warn", "info"];

    // Conjunction: "error", "warn" and "info"
    const msg1 = message`Expected ${valueSet(choices)}.`;

    // Disjunction: "error", "warn" or "info"
    const msg2 = message`Expected ${valueSet(choices, { type: "disjunction" })}.`;

    // Korean: "error", "warn" 또는 "info"
    const msg3 = message`${valueSet(choices, { locale: "ko", type: "disjunction" })}`;
    ~~~~

    The exact formatting depends on the locale.  If no locale is specified,
    `valueSet()` uses the system default locale, which may vary across
    environments.  For consistent formatting, specify a locale explicitly.

     -  Added `ValueSetOptions` interface.
     -  Added `valueSet()` function.

[#52]: https://github.com/dahlia/optique/issues/52
[#54]: https://github.com/dahlia/optique/issues/54
[#57]: https://github.com/dahlia/optique/issues/57
[#62]: https://github.com/dahlia/optique/issues/62
[#63]: https://github.com/dahlia/optique/issues/63
[#64]: https://github.com/dahlia/optique/issues/64
[#70]: https://github.com/dahlia/optique/pull/70

### @optique/run

 -  Added sync/async mode support to the `run()` function.  [[#52], [#70]]

    New functions for explicit mode handling:

     -  `runSync()`: Runs with a sync-only parser, returning the parsed value
        directly.
     -  `runAsync()`: Runs with any parser, returning a `Promise` of the parsed
        value.

    The existing `run()` function continues to work unchanged for sync parsers.
    For async parsers, use `runAsync()` or `await run()`.

    ~~~~ typescript
    import { run, runSync, runAsync } from "@optique/run";
    import { object } from "@optique/core/constructs";
    import { option } from "@optique/core/primitives";
    import { string } from "@optique/core/valueparser";

    // Example sync parser
    const syncParser = object({ name: option("-n", string()) });

    // Example async parser (with async value parser)
    const asyncParser = object({
      data: option("-d", {
        $mode: "async",
        metavar: "URL",
        async parse(input) {
          const res = await fetch(input);
          return { success: true, value: await res.text() };
        },
        format: (v) => v,
      }),
    });

    // Sync parser (default behavior, unchanged)
    const syncResult = run(syncParser);

    // Explicit sync-only (compile error if parser is async)
    const syncOnlyResult = runSync(syncParser);

    // Async parser support
    const asyncResult = await runAsync(asyncParser);
    ~~~~

 -  Added `mustNotExist` option to the `path()` value parser.  When set to
    `true`, the parser rejects paths that already exist on the filesystem,
    which is useful for output files to prevent accidental overwrites.  [[#56]]

    ~~~~ typescript
    // Output file must not exist
    const outputFile = path({ mustNotExist: true });

    // With extension validation
    const reportFile = path({
      mustNotExist: true,
      extensions: [".json", ".csv"]
    });
    ~~~~

 -  Refactored `PathOptions` into a discriminated union type to enforce mutual
    exclusivity between `mustExist` and `mustNotExist` options at compile time.
    Setting both to `true` now produces a TypeScript error instead of undefined
    runtime behavior.  [[#56]]

 -  Added `pathAlreadyExists` error customization option to `PathErrorOptions`
    for the `path()` value parser.  This allows custom error messages when
    a path already exists while using the `mustNotExist` option.  [[#56]]

 -  The `path()` value parser now validates that `metavar` is non-empty,
    throwing a `TypeError` if an empty string is provided.  [[#63]]

[#56]: https://github.com/dahlia/optique/issues/56

### @optique/temporal

 -  All temporal value parsers now validate that `metavar` is non-empty,
    throwing a `TypeError` if an empty string is provided.  [[#63]]

### @optique/git

The *@optique/git* package was introduced in this release, providing
async value parsers for validating Git references (branches, tags, commits,
remotes) using [isomorphic-git].  [[#71], [#72]]

 -  Added `gitBranch()` value parser for validating local branch names.
 -  Added `gitRemoteBranch(remote)` value parser for validating remote branch
    names on a specified remote.
 -  Added `gitTag()` value parser for validating tag names.
 -  Added `gitRemote()` value parser for validating remote names.
 -  Added `gitCommit()` value parser for validating commit SHAs (full or
    shortened).
 -  Added `gitRef()` value parser for validating any Git reference (branches,
    tags, or commits).
 -  Added `createGitParsers()` factory function for creating parsers with
    shared configuration.
 -  Added `GitParsers` interface for the factory return type.
 -  Added `GitParserOptions` interface for parser configuration.
 -  Added automatic shell completion suggestions for branches, tags, remotes,
    and commits.

[isomorphic-git]: https://github.com/isomorphic-git/isomorphic-git
[#71]: https://github.com/dahlia/optique/issues/71
[#72]: https://github.com/dahlia/optique/pull/72


Version 0.8.16
--------------

Released on February 19, 2026.

### @optique/core

 -  Fixed meta commands (`help`, `version`, `completion`, `completions`)
    disappearing from the subcommand list in help output when the parser uses
    a `withDefault(or(...))` construct.  The root cause was that
    `getDocPage()` used a `do...while` loop, which ran the parser at least
    once even with an empty argument buffer.  Because `withDefault(or(...))`
    allows the inner parser to succeed without consuming any tokens, the
    `longestMatch` combinator would record the user's parser as “selected”
    and subsequently return only that parser's doc fragments—silently
    dropping the meta command entries.  The loop is now a `while` loop that
    skips parsing entirely when the buffer is empty.  [[#121]]


Version 0.8.15
--------------

Released on February 18, 2026.

### @optique/core

 -  Fixed how `brief` and `description` are displayed in subcommand help
    pages.  [[#118], [#119]]

     -  Each help page now shows `brief` at the very top (before the Usage
        line) and `description` below the Usage line, consistent with how
        the root-level help page works.

     -  The `run()`-level `brief` and `description` no longer bleed into a
        subcommand's help page.  Previously, when a subcommand had no
        `description` of its own, the description supplied to `run()` would
        appear on the subcommand's help page (e.g. `repro file --help` would
        show “Description for repro CLI” even though that text describes the
        top-level program, not the `file` subcommand).  Now, only the
        subcommand's own `brief` and `description` (if any) are shown;
        run-level docs are used only for the root-level help page.

     -  When `command()` is wrapped with `group()`, the command's `brief`,
        `description`, and `footer` are now correctly forwarded to the help
        page.  Previously `group()` only forwarded `description`, so `brief`
        was silently dropped and the run-level brief appeared instead.

 -  Fixed contradictory “Did you mean?” suggestion when a subcommand name is
    provided at the wrong level.  Previously, a structure like
    `command("file", or(add, remove))` given the input `add --help` would
    report `Expected command file, but got add.` and then illogically suggest
    `Did you mean add?` even though `add` is only valid *inside* `file`.
    Suggestions in `command()` errors now derive from
    `extractLeadingCommandNames()`, which limits candidates to commands that
    are actually valid at the current parse position, not commands nested
    inside other commands.  The same scoping is applied when a custom
    `notMatched` callback receives its `suggestions` argument.  [[#117]]

 -  Fixed `group()` label leaking into a selected subcommand's own nested
    command list.  Previously, when a `group()`-wrapped command (e.g.,
    `alias`) itself contained further subcommands (e.g., `delete`, `set`),
    viewing `alias --help` would show those inner commands under the outer
    group's label (e.g., “Additional commands:”), which was incorrect.
    The fix compares current command entries against the initial set of
    commands that the group originally labeled; the label is now applied
    only when the visible commands are the group's own top-level commands,
    not commands from a deeper level.  [[#116]]


Version 0.8.14
--------------

Released on February 18, 2026.

### @optique/core

 -  Fixed `group()` incorrectly applying its label to subcommand flags
    in help output.  When `group()` wraps `command()` parsers (via `or()`),
    the group label is now only shown for the command list at the top level,
    not for the inner flags/options after a command is selected.  [[#114]]

 -  Fixed `merge()` not propagating `brief`, `description`, and `footer`
    from inner parsers in help output.  When using the
    `merge(or(...commands), globalOptions)` pattern, subcommand help
    (e.g., `myapp subcommand --help`) now correctly displays the command's
    description.  Previously, these fields were silently discarded by
    `merge()`.


Version 0.8.13
--------------

Released on February 17, 2026.

### @optique/core

 -  Fixed usage string collapsing to a single line when `completion` with
    `name: "both"` created a nested exclusive term (e.g.,
    `(completion | completions)`) inside an outer exclusive.
    `normalizeUsageTerm()` now distributes an exclusive that appears as the
    first term of a branch across the remaining terms, so that
    `[exclusive(A, B), C]` is flattened into separate branches `[A, C]` and
    `[B, C]`.  This allows `formatUsage()` with `expandCommands: true` to
    properly render each alternative on its own line.


Version 0.8.12
--------------

Released on February 14, 2026.

### @optique/core

 -  Fixed the `completion` command appearing before user-defined commands in
    the usage line shown on parse errors.  When using `completion` in command
    mode with `or()`-combined commands, the error output now lists user commands
    first and meta-commands (version, completion, help) after them.  [[#107]]


Version 0.8.11
--------------

Released on February 13, 2026.

### @optique/core

 -  Fixed contradictory suggestion messages for subcommand-only options at the
    root command level.  Previously, when an option that belongs to a
    subcommand was entered before specifying the subcommand (for example,
    `mycli --fooflag 123` where `--fooflag` belongs to `mycli foo`), the parser
    could report `Unexpected option or subcommand` and still suggest the same
    option.  Suggestions now only include options and commands that are valid at
    the current parse position.  [[#98]]

 -  Fixed `--completion` and `--completions` without a shell value in option
    mode reporting a generic parse error.  Previously, inputs like
    `mycli --completion` could fall through to normal argument parsing and show
    `Unexpected option or subcommand`, which was misleading.  These now produce
    the dedicated completion error for a missing shell name.  [[#100]]


Version 0.8.10
--------------

Released on February 12, 2026.

### @optique/core

 -  Fixed `mycli subcommand --help` displaying the `brief` and `description`
    passed to `run()` instead of those passed to `command()`.  Now, when
    showing help for a specific subcommand, the subcommand's own `brief`,
    `description`, and `footer` take priority over the `run()`-level values.
    The `run()`-level values are used as fallback only when the subcommand
    does not define its own.  [[#95]]


Version 0.8.9
-------------

Released on February 12, 2026.

### @optique/core

 -  Fixed `run()` showing top-level help instead of an error when `--help`
    is used with an invalid subcommand (e.g., `mycli nonexistent --help`).
    Previously, the help handler did not validate whether the commands
    extracted before `--help` were actually recognized by the parser,
    so it silently fell back to displaying root-level help.  Now, the
    commands are validated against the parser, and an appropriate error
    message with usage information is shown instead.  [[#97]]
 -  Fixed nested subcommand help showing sibling subcommand usage lines.
    Previously, when using `or(topLevel, command("nested", or(foo, bar)))`,
    running `mycli nested foo --help` would incorrectly display usage lines
    for both `foo` and `bar` subcommands.  Now, only the selected subcommand's
    usage is shown.  [[#96]]


Version 0.8.8
-------------

Released on January 19, 2026.

### @optique/core

 -  Fixed `command()` failing to parse inner parser when buffer is empty after
    command match.  Previously, when using `command()` with an inner parser
    that can succeed with zero tokens (like `longestMatch()` or `object()` with
    all optional fields), parsing `["dev"]` would fail with “No matching option,
    command, or argument found” even though the inner parser should succeed.
    Now, the `complete()` method first gives the inner parser a chance to run
    with an empty buffer before completing.  [[#81]]


Version 0.8.7
-------------

Released on January 5, 2026.

### @optique/core

 -  Fixed `multiple()` parser suggesting already-selected values in shell
    completion.  Previously, when using `multiple(argument(choice(...)))` or
    similar patterns, values that had already been selected would continue
    to appear in completion suggestions.  Now, the `suggest()` method filters
    out values that have already been parsed, providing a cleaner completion
    experience.  [[#73]]

[#73]: https://github.com/dahlia/optique/issues/73


Version 0.8.6
-------------

Released on January 1, 2026.

### @optique/core

 -  Fixed `object()` parser ignoring symbol keys.  Previously, when using
    symbol keys in the parser definition (e.g.,
    `object({ [sym]: option(...) })`), the symbol-keyed parsers were silently
    ignored because `Object.entries()` and `for...in` loops do not enumerate
    symbol properties.  Now, the parser correctly handles both string and
    symbol keys by using `Reflect.ownKeys()`.


Version 0.8.5
-------------

Released on December 30, 2025.

### @optique/core

 -  Fixed subcommand help display when using `merge()` with `or()`.
    Previously, when combining parsers using `merge(..., or(...))`, the help
    output would fail to display subcommand-specific options because `merge()`
    did not correctly propagate the runtime state of parsers with undefined
    initial state.  Now, the state is correctly resolved, ensuring that
    subcommand help is generated correctly.  [[#69]]

 -  Fixed subcommand help displaying incorrect usage line when using
    `longestMatch()` with nested subcommands.  Previously, when using patterns
    like `longestMatch(merge(globalOptions, or(sub1, sub2)), helpCommand)`,
    the usage line in `help COMMAND` output would show all subcommand
    alternatives instead of only the selected subcommand's usage.  Now, the
    usage line correctly displays only the relevant subcommand.

[#69]: https://github.com/dahlia/optique/issues/69


Version 0.8.4
-------------

Released on December 30, 2025.

### @optique/core

 -  Added default descriptions for built-in `help` command argument and
    completion option arguments. Previously, these arguments showed no help
    text. Now they display helpful default descriptions in help output.

 -  Fixed subcommand help not displaying option descriptions in some edge cases.
    When using `help COMMAND` or `COMMAND --help`, the help output now
    correctly passes the inner parser's initial state for documentation
    generation when the command is matched but the inner parser hasn't started
    yet.  Previously, it passed `unavailable` state which could cause issues
    with parsers that depend on state for documentation.  [[#68]]

[#68]: https://github.com/dahlia/optique/issues/68

### @optique/logtape

 -  Added default descriptions for `verbosity()`, `debug()`, and `logOutput()`
    parsers. Previously, these parsers showed no help text unless users
    explicitly provided a `description` option. Now they display helpful
    default descriptions in help output.


Version 0.8.3
-------------

Released on December 30, 2025.

### @optique/core

 -  Fixed `merge()` breaking option parsing inside subcommands when merged with
    `or()`.  Previously, when using `merge(globalOptions, or(sub1, sub2))`,
    options inside the subcommands would fail to parse after the subcommand was
    selected.  For example, `sub1 -o foo` would fail with “No matching option
    or argument found” even though `-o` was a valid option for `sub1`.
    [[#67]]

[#67]: https://github.com/dahlia/optique/issues/67


Version 0.8.2
-------------

Released on December 21, 2025.

### @optique/core

 -  Fixed `withDefault()` widening literal types in its default value parameter.
    Previously, passing a literal type as the default value would cause type
    widening (e.g., `"auto"` → `string`, `42` → `number`).  Now literal
    types are correctly preserved.  For example,
    `withDefault(option("--format", choice(["auto", "text"])), "auto")` now
    correctly infers `"auto" | "text"` instead of `string`.  [[#58]]

[#58]: https://github.com/dahlia/optique/issues/58


Version 0.8.1
-------------

Released on December 16, 2025.

### @optique/core

 -  Fixed shell completion scripts using singular form (`completion`,
    `--completion`) even when `completion.name` is set to `"plural"`.  Now,
    when the name is `"plural"`, the generated scripts correctly use
    `completions` or `--completions` instead of the singular form.  [[#53]]

 -  Fixed shell completion suggestions including positional argument values
    when completing an option that expects a value.  For example, when
    completing `--remote ""` in a parser with both `--remote` option and
    positional tag arguments, only the remote values are now suggested,
    not the tag values.  [[#55]]

[#53]: https://github.com/dahlia/optique/issues/53
[#55]: https://github.com/dahlia/optique/issues/55


Version 0.8.0
-------------

Released on December 9, 2025.

### @optique/core

 -  Added `conditional()` combinator for discriminated union patterns where
    certain options depend on a discriminator option value. This enables
    context-dependent parsing where different sets of options become valid
    based on the discriminator selection.  [[#49]]

    ~~~~ typescript
    const parser = conditional(
      option("--reporter", choice(["console", "junit", "html"])),
      {
        console: object({}),
        junit: object({ outputFile: option("--output-file", string()) }),
        html: object({ outputFile: option("--output-file", string()) }),
      }
    );
    // Result type: ["console", {}] | ["junit", { outputFile: string }] | ...
    ~~~~

    Key features:

     -  Explicit discriminator option determines which branch is selected
     -  Tuple result `[discriminator, branchValue]` for clear type narrowing
     -  Optional default branch for when discriminator is not provided
     -  Clear error messages indicating which options are required for each
        discriminator value

 -  Added `literal` type to `UsageTerm` for representing fixed string values in
    usage descriptions. Unlike metavars (which are placeholders displayed with
    special formatting), literals are displayed as plain text. This is used
    internally by `conditional()` to show actual discriminator values in help
    text (e.g., `--reporter console` instead of `--reporter TYPE`).  [[#49]]

 -  Added `passThrough()` parser for building wrapper CLI tools that need to
    forward unrecognized options to an underlying tool. This parser captures
    unknown options without validation errors, enabling legitimate wrapper/proxy
    patterns.  [[#35]]

    ~~~~ typescript
    const parser = object({
      debug: option("--debug"),
      extra: passThrough(),
    });

    // mycli --debug --foo=bar --baz=qux
    // → { debug: true, extra: ["--foo=bar", "--baz=qux"] }
    ~~~~

    Key features:

     -  Three capture formats: `"equalsOnly"` (default, safest), `"nextToken"`
        (captures `--opt val` pairs), and `"greedy"` (captures all remaining
        tokens)
     -  Lowest priority (−10) ensures explicit parsers always match first
     -  Respects `--` options terminator in `"equalsOnly"` and `"nextToken"`
        modes
     -  Works seamlessly with `object()`, subcommands, and other combinators

 -  Added `passthrough` type to `UsageTerm` for representing pass-through
    options in usage descriptions. Displayed as `[...]` in help text.

 -  Fixed `integer()` value parser to accept negative integers when using
    `type: "number"`. Previously, the regex pattern only matched non-negative
    integers (`/^\d+$/`), causing inputs like `-42` to be rejected as invalid.
    The pattern has been updated to `/^-?\d+$/` to correctly handle negative
    values. Note that `type: "bigint"` already accepted negative integers via
    `BigInt()` conversion, so this change brings consistency between the two
    types.

[#35]: https://github.com/dahlia/optique/issues/35
[#49]: https://github.com/dahlia/optique/issues/49

### @optique/logtape

The *@optique/logtape* package was introduced in this release, providing
integration with the [LogTape] logging library. This package enables
configuring LogTape logging through command-line arguments with various
parsing strategies.

 -  Added `logLevel()` value parser for parsing log level strings (`"trace"`,
    `"debug"`, `"info"`, `"warning"`, `"error"`, `"fatal"`) into LogTape's
    `LogLevel` type. Parsing is case-insensitive and provides shell completion
    suggestions.

 -  Added `verbosity()` parser for accumulating `-v` flags to determine log
    level. Each additional `-v` flag increases verbosity: no flags →
    `"warning"`, `-v` → `"info"`, `-vv` → `"debug"`, `-vvv` → `"trace"`.

 -  Added `debug()` parser for simple `--debug`/`-d` flag that toggles between
    normal level (`"info"`) and debug level (`"debug"`).

 -  Added `logOutput()` parser for log output destination. Accepts `-` for
    console output or a file path for file output, following CLI conventions.

 -  Added `loggingOptions()` preset that combines log level and log output
    options into a single `group()`. Uses a discriminated union configuration
    to enforce mutually exclusive level selection methods (`"option"`,
    `"verbosity"`, or `"debug"`).

 -  Added `createLoggingConfig()` helper function that converts parsed logging
    options into a LogTape `Config` object for use with `configure()`.

 -  Added `createConsoleSink()` function for creating console sinks with
    configurable stream selection (stdout/stderr) and level-based stream
    resolution.

 -  Added `createSink()` async function that creates LogTape sinks from
    `LogOutput` values. File output requires the optional `@logtape/file`
    package.

[LogTape]: https://logtape.org/


Version 0.7.18
--------------

Released on February 19, 2026.

### @optique/core

 -  Fixed meta commands (`help`, `version`, `completion`, `completions`)
    disappearing from the subcommand list in help output when the parser uses
    a `withDefault(or(...))` construct.  The root cause was that
    `getDocPage()` used a `do...while` loop, which ran the parser at least
    once even with an empty argument buffer.  Because `withDefault(or(...))`
    allows the inner parser to succeed without consuming any tokens, the
    `longestMatch` combinator would record the user's parser as “selected”
    and subsequently return only that parser's doc fragments—silently
    dropping the meta command entries.  The loop is now a `while` loop that
    skips parsing entirely when the buffer is empty.  [[#121]]


Version 0.7.17
--------------

Released on February 18, 2026.

### @optique/core

 -  Fixed how `brief` and `description` are displayed in subcommand help
    pages.  [[#118], [#119]]

     -  Each help page now shows `brief` at the very top (before the Usage
        line) and `description` below the Usage line, consistent with how
        the root-level help page works.

     -  The `run()`-level `brief` and `description` no longer bleed into a
        subcommand's help page.  Previously, when a subcommand had no
        `description` of its own, the description supplied to `run()` would
        appear on the subcommand's help page (e.g. `repro file --help` would
        show “Description for repro CLI” even though that text describes the
        top-level program, not the `file` subcommand).  Now, only the
        subcommand's own `brief` and `description` (if any) are shown;
        run-level docs are used only for the root-level help page.

     -  When `command()` is wrapped with `group()`, the command's `brief`,
        `description`, and `footer` are now correctly forwarded to the help
        page.  Previously `group()` only forwarded `description`, so `brief`
        was silently dropped and the run-level brief appeared instead.

 -  Fixed contradictory “Did you mean?” suggestion when a subcommand name is
    provided at the wrong level.  Previously, a structure like
    `command("file", or(add, remove))` given the input `add --help` would
    report `Expected command file, but got add.` and then illogically suggest
    `Did you mean add?`—even though `add` is only valid *inside* `file`.
    Suggestions in `command()` errors now derive from
    `extractLeadingCommandNames()`, which limits candidates to commands that
    are actually valid at the current parse position, not commands nested
    inside other commands.  The same scoping is applied when a custom
    `notMatched` callback receives its `suggestions` argument.  [[#117]]

 -  Fixed `group()` label leaking into a selected subcommand's own nested
    command list.  Previously, when a `group()`-wrapped command (e.g.,
    `alias`) itself contained further subcommands (e.g., `delete`, `set`),
    viewing `alias --help` would show those inner commands under the outer
    group's label (e.g., “Additional commands:”), which was incorrect.
    The fix compares current command entries against the initial set of
    commands that the group originally labeled; the label is now applied
    only when the visible commands are the group's own top-level commands,
    not commands from a deeper level.  [[#116]]


Version 0.7.16
--------------

Released on February 18, 2026.

### @optique/core

 -  Fixed `group()` incorrectly applying its label to subcommand flags
    in help output.  When `group()` wraps `command()` parsers (via `or()`),
    the group label is now only shown for the command list at the top level,
    not for the inner flags/options after a command is selected.  [[#114]]

 -  Fixed `merge()` not propagating `brief`, `description`, and `footer`
    from inner parsers in help output.  When using the
    `merge(or(...commands), globalOptions)` pattern, subcommand help
    (e.g., `myapp subcommand --help`) now correctly displays the command's
    description.  Previously, these fields were silently discarded by
    `merge()`.


Version 0.7.15
--------------

Released on February 17, 2026.

### @optique/core

 -  Fixed usage string collapsing to a single line when `completion` with
    `name: "both"` created a nested exclusive term (e.g.,
    `(completion | completions)`) inside an outer exclusive.
    `normalizeUsageTerm()` now distributes an exclusive that appears as the
    first term of a branch across the remaining terms, so that
    `[exclusive(A, B), C]` is flattened into separate branches `[A, C]` and
    `[B, C]`.  This allows `formatUsage()` with `expandCommands: true` to
    properly render each alternative on its own line.


Version 0.7.14
--------------

Released on February 14, 2026.

### @optique/core

 -  Fixed the `completion` command appearing before user-defined commands in
    the usage line shown on parse errors.  When using `completion` in command
    mode with `or()`-combined commands, the error output now lists user commands
    first and meta-commands (version, completion, help) after them.  [[#107]]


Version 0.7.13
--------------

Released on February 13, 2026.

### @optique/core

 -  Fixed contradictory suggestion messages for subcommand-only options at the
    root command level.  Previously, when an option that belongs to a
    subcommand was entered before specifying the subcommand (for example,
    `mycli --fooflag 123` where `--fooflag` belongs to `mycli foo`), the parser
    could report `Unexpected option or subcommand` and still suggest the same
    option.  Suggestions now only include options and commands that are valid at
    the current parse position.  [[#98]]

 -  Fixed `--completion` and `--completions` without a shell value in option
    mode reporting a generic parse error.  Previously, inputs like
    `mycli --completion` could fall through to normal argument parsing and show
    `Unexpected option or subcommand`, which was misleading.  These now produce
    the dedicated completion error for a missing shell name.  [[#100]]


Version 0.7.12
--------------

Released on February 12, 2026.

### @optique/core

 -  Fixed `mycli subcommand --help` displaying the `brief` and `description`
    passed to `run()` instead of those passed to `command()`.  Now, when
    showing help for a specific subcommand, the subcommand's own `brief`,
    `description`, and `footer` take priority over the `run()`-level values.
    The `run()`-level values are used as fallback only when the subcommand
    does not define its own.  [[#95]]


Version 0.7.11
--------------

Released on February 12, 2026.

### @optique/core

 -  Fixed `run()` showing top-level help instead of an error when `--help`
    is used with an invalid subcommand (e.g., `mycli nonexistent --help`).
    Previously, the help handler did not validate whether the commands
    extracted before `--help` were actually recognized by the parser,
    so it silently fell back to displaying root-level help.  Now, the
    commands are validated against the parser, and an appropriate error
    message with usage information is shown instead.  [[#97]]


Version 0.7.10
--------------

Released on January 19, 2026.

### @optique/core

 -  Fixed `command()` failing to parse inner parser when buffer is empty after
    command match.  Previously, when using `command()` with an inner parser
    that can succeed with zero tokens (like `longestMatch()` or `object()` with
    all optional fields), parsing `["dev"]` would fail with “No matching option,
    command, or argument found” even though the inner parser should succeed.
    Now, the `complete()` method first gives the inner parser a chance to run
    with an empty buffer before completing.  [[#81]]


Version 0.7.9
-------------

Released on January 5, 2026.

### @optique/core

 -  Fixed `multiple()` parser suggesting already-selected values in shell
    completion.  Previously, when using `multiple(argument(choice(...)))` or
    similar patterns, values that had already been selected would continue
    to appear in completion suggestions.  Now, the `suggest()` method filters
    out values that have already been parsed, providing a cleaner completion
    experience.  [[#73]]


Version 0.7.8
-------------

Released on January 1, 2026.

### @optique/core

 -  Fixed `object()` parser ignoring symbol keys.  Previously, when using
    symbol keys in the parser definition (e.g.,
    `object({ [sym]: option(...) })`), the symbol-keyed parsers were silently
    ignored because `Object.entries()` and `for...in` loops do not enumerate
    symbol properties.  Now, the parser correctly handles both string and
    symbol keys by using `Reflect.ownKeys()`.


Version 0.7.7
-------------

Released on December 30, 2025.

### @optique/core

 -  Fixed subcommand help display when using `merge()` with `or()`.
    Previously, when combining parsers using `merge(..., or(...))`, the help
    output would fail to display subcommand-specific options because `merge()`
    did not correctly propagate the runtime state of parsers with undefined
    initial state.  Now, the state is correctly resolved, ensuring that
    subcommand help is generated correctly.  [[#69]]

 -  Fixed subcommand help displaying incorrect usage line when using
    `longestMatch()` with nested subcommands.  Previously, when using patterns
    like `longestMatch(merge(globalOptions, or(sub1, sub2)), helpCommand)`,
    the usage line in `help COMMAND` output would show all subcommand
    alternatives instead of only the selected subcommand's usage.  Now, the
    usage line correctly displays only the relevant subcommand.


Version 0.7.6
-------------

Released on December 30, 2025.

### @optique/core

 -  Added default descriptions for built-in `help` command argument and
    completion option arguments. Previously, these arguments showed no help
    text. Now they display helpful default descriptions in help output.

 -  Fixed subcommand help not displaying option descriptions in some edge cases.
    When using `help COMMAND` or `COMMAND --help`, the help output now
    correctly passes the inner parser's initial state for documentation
    generation when the command is matched but the inner parser hasn't started
    yet.  Previously, it passed `unavailable` state which could cause issues
    with parsers that depend on state for documentation.  [[#68]]


Version 0.7.5
-------------

Released on December 30, 2025.

### @optique/core

 -  Fixed `merge()` breaking option parsing inside subcommands when merged with
    `or()`.  Previously, when using `merge(globalOptions, or(sub1, sub2))`,
    options inside the subcommands would fail to parse after the subcommand was
    selected.  For example, `sub1 -o foo` would fail with “No matching option
    or argument found” even though `-o` was a valid option for `sub1`.
    [[#67]]


Version 0.7.4
-------------

Released on December 21, 2025.

### @optique/core

 -  Fixed `withDefault()` widening literal types in its default value parameter.
    Previously, passing a literal type as the default value would cause type
    widening (e.g., `"auto"` → `string`, `42` → `number`).  Now literal
    types are correctly preserved.  For example,
    `withDefault(option("--format", choice(["auto", "text"])), "auto")` now
    correctly infers `"auto" | "text"` instead of `string`.  [[#58]]


Version 0.7.3
-------------

Released on December 16, 2025.

### @optique/core

 -  Fixed shell completion scripts using singular form (`completion`,
    `--completion`) even when `completion.name` is set to `"plural"`.  Now,
    when the name is `"plural"`, the generated scripts correctly use
    `completions` or `--completions` instead of the singular form.  [[#53]]

 -  Fixed shell completion suggestions including positional argument values
    when completing an option that expects a value.  For example, when
    completing `--remote ""` in a parser with both `--remote` option and
    positional tag arguments, only the remote values are now suggested,
    not the tag values.  [[#55]]


Version 0.7.2
-------------

Released on December 2, 2025.

### @optique/core

 -  Fixed `optional()` and `withDefault()` returning an error instead of the
    expected value when the input contains only the options terminator `"--"`.
    For example, `parse(withDefault(option("--name", string()), "Bob"), ["--"])`
    now correctly returns `"Bob"` instead of failing with “Missing option
    `--name`.”  [[#50]]

[#50]: https://github.com/dahlia/optique/issues/50


Version 0.7.1
-------------

Released on December 2, 2025.

### @optique/core

 -  Fixed `optional()` and `withDefault()` returning an error instead of the
    expected value when used as a standalone parser with empty input.  For
    example, `parse(withDefault(option("--name", string()), "Bob"), [])` now
    correctly returns `"Bob"` instead of failing with “Expected an option,
    but got end of input.”  [[#48]]

[#48]: https://github.com/dahlia/optique/issues/48


Version 0.7.0
-------------

Released on November 25, 2025.

### @optique/core

 -  Added duplicate option name detection to parser combinators. The `object()`,
    `tuple()`, `merge()`, and `group()` combinators now validate at parse time
    that option names are unique across their child parsers. When duplicate
    option names are detected, parsing fails with a clear error message
    indicating which option name is duplicated and in which fields or positions.
    [[#37]]

     -  Added `ObjectOptions.allowDuplicates` field to opt out of validation.
     -  Added `TupleOptions` interface with `allowDuplicates` field.
     -  Added `MergeOptions` interface with `allowDuplicates` field.
     -  Added `tuple()` overloads accepting optional `TupleOptions` parameter.
     -  Added `extractOptionNames()` function to `@optique/core/usage` module.

 -  Changed parsing behavior: `object()`, `tuple()`, `merge()`, and `group()`
    now reject parsers with duplicate option names by default. Previously,
    duplicate option names would result in ambiguous parsing where the first
    matching parser consumed the option and subsequent parsers silently received
    default values. This breaking change prevents unintentional bugs from option
    name conflicts.

    To restore previous behavior, set `allowDuplicates: true` in options.
    [[#37]]

 -  The `or()` combinator continues to allow duplicate option names across
    branches since alternatives are mutually exclusive.  [[#37]]

 -  Added “Did you mean?” suggestion system for typos in option names and
    command names. When users make typos in command-line arguments, Optique
    now automatically suggests similar valid options to help them correct
    the mistake:

    ~~~~ typescript
    const parser = object({
      verbose: option("-v", "--verbose"),
      version: option("--version"),
    });

    // User types: --verbos (typo)
    const result = parse(parser, ["--verbos"]);
    // Error: No matched option for `--verbos`.
    // Did you mean `--verbose`?
    ~~~~

    The suggestion system uses Levenshtein distance to find similar names,
    suggesting up to 3 alternatives when the edit distance is at most 3
    characters and the distance ratio is at most 0.5. Comparison is
    case-insensitive by default. Suggestions work automatically for both
    option names and subcommand names in all error contexts (`option()`,
    `flag()`, `command()`, `object()`, `or()`, and `longestMatch()` parsers).
    This feature is implemented internally and requires no user configuration.
    [[#38]]

 -  Added customization support for “Did you mean?” suggestion messages.
    All parsers that generate suggestion messages now support customizing
    how suggestions are formatted or disabling them entirely through the
    `errors` option:

    ~~~~ typescript
    // Custom suggestion format for option/flag parsers
    const portOption = option("--port", integer(), {
      errors: {
        noMatch: (invalidOption, suggestions) =>
          suggestions.length > 0
            ? message`Unknown option ${invalidOption}. Try: ${values(suggestions)}`
            : message`Unknown option ${invalidOption}.`
      }
    });

    // Custom suggestion format for command parser
    const addCmd = command("add", object({}), {
      errors: {
        notMatched: (expected, actual, suggestions) =>
          suggestions && suggestions.length > 0
            ? message`Unknown command ${actual}. Similar: ${values(suggestions)}`
            : message`Expected ${expected} command.`
      }
    });

    // Custom suggestion formatter for combinators
    const config = object({
      host: option("--host", string()),
      port: option("--port", integer())
    }, {
      errors: {
        suggestions: (suggestions) =>
          suggestions.length > 0
            ? message`Available options: ${values(suggestions)}`
            : []
      }
    });
    ~~~~

    The customization system allows complete control over suggestion
    formatting while maintaining backward compatibility. When custom error
    messages are provided, they receive the array of suggestions and can
    format, filter, or disable them as needed. This enables applications
    to provide context-specific error messages that match their CLI's
    style and user expectations.  [[#38]]

     -  Extended `OptionErrorOptions` interface with `noMatch` field.
     -  Extended `FlagErrorOptions` interface with `noMatch` field.
     -  Extended `CommandErrorOptions.notMatched` signature to include
        optional `suggestions` parameter.
     -  Extended `OrErrorOptions` interface with `suggestions` field.
     -  Extended `LongestMatchErrorOptions` interface with `suggestions` field.
     -  Extended `ObjectErrorOptions` interface with `suggestions` field.

 -  Improved `formatMessage()` line break handling to distinguish between
    soft breaks (word wrap) and hard breaks (paragraph separation):

     -  Single newlines (`\n`) are now treated as soft breaks, converted to
        spaces for natural word wrapping. This allows long error messages to
        be written across multiple lines in source code while rendering as
        continuous text.

     -  Double or more consecutive newlines (`\n\n+`) are treated as hard
        breaks, creating actual paragraph separations in the output.

    This change improves the readability of multi-part error messages, such
    as those with “Did you mean?” suggestions, by ensuring proper spacing
    between the base error and suggestions:

    ~~~~
    Error: Unexpected option or subcommand: comit.
    Did you mean commit?
    ~~~~

    Previously, single newlines in `text()` terms would be silently dropped
    during word wrapping, causing messages to run together without spacing.

 -  Improved error messages for `or()`, `longestMatch()`, and `object()`
    combinators to provide context-aware feedback based on expected input types.
    Error messages now accurately reflect what's missing (options, commands, or
    arguments) instead of showing generic “No matching option or command found”
    for all cases. [[#45]]

    ~~~~ typescript
    // When only arguments are expected
    const parser1 = or(argument(string()), argument(integer()));
    // Error: Missing required argument.

    // When only commands are expected
    const parser2 = or(command("add", ...), command("remove", ...));
    // Error: No matching command found.

    // When both options and arguments are expected
    const parser3 = object({
      port: option("--port", integer()),
      file: argument(string()),
    });
    // Error: No matching option or argument found.
    ~~~~

 -  Added function-form support for `errors.noMatch` option in `or()`,
    `longestMatch()`, and `object()` combinators. Error messages can now be
    dynamically generated based on context, enabling use cases like
    internationalization:

    ~~~~ typescript
    const parser = or(
      command("add", constant("add")),
      command("remove", constant("remove")),
      {
        errors: {
          noMatch: ({ hasOptions, hasCommands, hasArguments }) => {
            if (hasCommands && !hasOptions && !hasArguments) {
              return message`일치하는 명령을 찾을 수 없습니다.`; // Korean
            }
            return message`잘못된 입력입니다.`;
          }
        }
      }
    );
    ~~~~

    The callback receives a `NoMatchContext` object with Boolean flags
    (`hasOptions`, `hasCommands`, `hasArguments`) indicating what types of
    inputs are expected. This allows generating language-specific or
    context-specific error messages while maintaining backward compatibility
    with static message form. [[#45]]

     -  Added `NoMatchContext` interface.
     -  Extended `OrErrorOptions.noMatch` to accept
        `Message | ((context: NoMatchContext) => Message)`.
     -  Extended `LongestMatchErrorOptions.noMatch` to accept
        `Message | ((context: NoMatchContext) => Message)`.
     -  Extended `ObjectErrorOptions.endOfInput` to accept
        `Message | ((context: NoMatchContext) => Message)`.
     -  Added `extractArgumentMetavars()` function to
        `@optique/core/usage` module.

 -  Added configuration for shell completion naming conventions. The `run()`
    function now supports both singular (`completion`, `--completion`) and
    plural (`completions`, `--completions`) naming styles. By default, both
    forms are accepted (`"both"`), but this can be restricted to just one style
    using the new `name` option in the completion configuration:

    ~~~~ typescript
    run(parser, {
      completion: {
        // Use "completions" and "--completions" only
        name: "plural",
      }
    });
    ~~~~

    This allows CLI tools to match their preferred style guide or exist alongside
    other commands. The help text examples automatically reflect the configured
    naming style. [[#42]]

     -  Added `name` option to `RunOptions.completion` configuration (`"singular"`,
        `"plural"`, or `"both"`).

[#37]: https://github.com/dahlia/optique/issues/37
[#38]: https://github.com/dahlia/optique/issues/38
[#42]: https://github.com/dahlia/optique/issues/42
[#45]: https://github.com/dahlia/optique/issues/45

### @optique/valibot

The *@optique/valibot* package was introduced in this release, providing
integration with the [Valibot] validation library. This package enables using
Valibot schemas as value parsers, bringing Valibot's powerful validation
capabilities with a significantly smaller bundle size (~10KB vs Zod's ~52KB)
to command-line argument parsing. Supports Valibot version 0.42.0 and above.
[[#40]]

 -  Added `valibot()` value parser for validating command-line arguments using
    Valibot schemas.
 -  Added `ValibotParserOptions` interface for configuring metavar and custom
    error messages.
 -  Added automatic metavar inference from Valibot schema types (`STRING`,
    `EMAIL`, `NUMBER`, `INTEGER`, `CHOICE`, etc.).

[Valibot]: https://valibot.dev/
[#40]: https://github.com/dahlia/optique/issues/40

### @optique/zod

The *@optique/zod* package was introduced in this release, providing
integration with the [Zod] validation library. This package enables using
Zod schemas as value parsers, bringing Zod's powerful validation capabilities
to command-line argument parsing. Supports both Zod v3.25.0+ and v4.0.0+.
[[#39]]

 -  Added `zod()` value parser for validating command-line arguments using
    Zod schemas.
 -  Added `ZodParserOptions` interface for configuring metavar and custom
    error messages.

[Zod]: https://zod.dev/
[#39]: https://github.com/dahlia/optique/issues/39


Version 0.6.11
--------------

Released on January 5, 2026.

### @optique/core

 -  Fixed `multiple()` parser suggesting already-selected values in shell
    completion.  Previously, when using `multiple(argument(choice(...)))` or
    similar patterns, values that had already been selected would continue
    to appear in completion suggestions.  Now, the `suggest()` method filters
    out values that have already been parsed, providing a cleaner completion
    experience.  [[#73]]


Version 0.6.10
--------------

Released on January 1, 2026.

### @optique/core

 -  Fixed `object()` parser ignoring symbol keys.  Previously, when using
    symbol keys in the parser definition (e.g.,
    `object({ [sym]: option(...) })`), the symbol-keyed parsers were silently
    ignored because `Object.entries()` and `for...in` loops do not enumerate
    symbol properties.  Now, the parser correctly handles both string and
    symbol keys by using `Reflect.ownKeys()`.


Version 0.6.9
-------------

Released on December 30, 2025.

### @optique/core

 -  Fixed subcommand help display when using `merge()` with `or()`.
    Previously, when combining parsers using `merge(..., or(...))`, the help
    output would fail to display subcommand-specific options because `merge()`
    did not correctly propagate the runtime state of parsers with undefined
    initial state.  Now, the state is correctly resolved, ensuring that
    subcommand help is generated correctly.  [[#69]]

 -  Fixed subcommand help displaying incorrect usage line when using
    `longestMatch()` with nested subcommands.  Previously, when using patterns
    like `longestMatch(merge(globalOptions, or(sub1, sub2)), helpCommand)`,
    the usage line in `help COMMAND` output would show all subcommand
    alternatives instead of only the selected subcommand's usage.  Now, the
    usage line correctly displays only the relevant subcommand.


Version 0.6.8
-------------

Released on December 30, 2025.

### @optique/core

 -  Added default descriptions for built-in `help` command argument and
    completion option arguments. Previously, these arguments showed no help
    text. Now they display helpful default descriptions in help output.

 -  Fixed subcommand help not displaying option descriptions in some edge cases.
    When using `help COMMAND` or `COMMAND --help`, the help output now
    correctly passes the inner parser's initial state for documentation
    generation when the command is matched but the inner parser hasn't started
    yet.  Previously, it passed `unavailable` state which could cause issues
    with parsers that depend on state for documentation.  [[#68]]


Version 0.6.7
-------------

Released on December 30, 2025.

### @optique/core

 -  Fixed `merge()` breaking option parsing inside subcommands when merged with
    `or()`.  Previously, when using `merge(globalOptions, or(sub1, sub2))`,
    options inside the subcommands would fail to parse after the subcommand was
    selected.  For example, `sub1 -o foo` would fail with “No matching option
    or argument found” even though `-o` was a valid option for `sub1`.
    [[#67]]


Version 0.6.6
-------------

Released on December 21, 2025.

### @optique/core

 -  Fixed `withDefault()` widening literal types in its default value parameter.
    Previously, passing a literal type as the default value would cause type
    widening (e.g., `"auto"` → `string`, `42` → `number`).  Now literal
    types are correctly preserved.  For example,
    `withDefault(option("--format", choice(["auto", "text"])), "auto")` now
    correctly infers `"auto" | "text"` instead of `string`.  [[#58]]


Version 0.6.5
-------------

Released on December 2, 2025.

### @optique/core

 -  Fixed `optional()` and `withDefault()` returning an error instead of the
    expected value when the input contains only the options terminator `"--"`.
    For example, `parse(withDefault(option("--name", string()), "Bob"), ["--"])`
    now correctly returns `"Bob"` instead of failing with “Missing option
    `--name`.”  [[#50]]


Version 0.6.4
-------------

Rleased on December 2, 2025.

### @optique/core

 -  Fixed `optional()` and `withDefault()` returning an error instead of the
    expected value when used as a standalone parser with empty input.  For
    example, `parse(withDefault(option("--name", string()), "Bob"), [])` now
    correctly returns `"Bob"` instead of failing with “Expected an option,
    but got end of input.”  [[#48]]


Version 0.6.3
-------------

Released on November 25, 2025.

### @optique/core

 -  Fixed shell completion scripts using `completion` subcommand even when
    `completion.mode` is set to `"option"`. Now, when the mode is `"option"`,
    the generated scripts correctly use `--completion` instead of `completion`.
    [[#41]]

[#41]: https://github.com/dahlia/optique/issues/41


Version 0.6.2
-------------

Released on October 27, 2025.

### @optique/core

 -  Fixed incorrect CommonJS type export paths in `package.json`. The
    `"require"` type paths for submodules were incorrectly pointing to
    `"*.cts"` files instead of `"*.d.cts"` files, causing type resolution
    issues when importing submodules in CommonJS environments.  [[#36]]

[#36]: https://github.com/dahlia/optique/issues/36

### @optique/run

 -  Fixed incorrect CommonJS type export paths in `package.json`. The
    `"require"` type paths for submodules were incorrectly pointing to
    `"*.cts"` files instead of `"*.d.cts"` files, causing type resolution
    issues when importing submodules in CommonJS environments.  [[#36]]


Version 0.6.1
-------------

Released on October 8, 2025.

### @optique/run

 -  Fixed inconsistent error message coloring in Bun runtime by replacing
    reliance on default `console.error()` and `console.log()` with direct
    `process.stderr.write()` and `process.stdout.write()` calls. Previously,
    Bun's `console.error()` would add red coloring by default, which
    interfered with ANSI formatting in error messages. This change ensures
    consistent output formatting across all JavaScript runtimes (Node.js,
    Bun, and Deno).


Version 0.6.0
-------------

Released on October 2, 2025.

### @optique/core

 -  Added shell completion support for Bash, zsh, fish, PowerShell, and Nushell.
    Optique now provides built-in completion functionality that integrates
    seamlessly with the existing parser architecture. This allows CLI
    applications to offer intelligent suggestions for commands, options, and
    arguments without requiring additional configuration.
    [[#5], [#30], [#31], [#33]]

     -  Added `Suggestion` type.
     -  Added `Parser.suggest()` method.
     -  Added `ValueParser.suggest()` method.
     -  Added `suggest()` function.
     -  Added `@optique/core/completion` module.
     -  Added `ShellCompletion` interface.
     -  Added `bash`, `zsh`, `fish`, `pwsh`, and `nu` shell completion
        generators.
     -  Added `RunOptions.completion` option.

 -  Added `brief` and `footer` options to `command()` parser for improved
    documentation control. The `brief` option provides a short description for
    command listings (e.g., `myapp help`), while `description` is used for
    detailed help (e.g., `myapp help subcommand` or `myapp subcommand --help`).
    The `footer` option allows adding examples or additional information at the
    bottom of command-specific help text.

     -  Added `CommandOptions.brief` field.
     -  Added `CommandOptions.footer` field.
     -  Added `DocFragments.footer` field.

 -  Added `commandLine` message term type for formatting command-line examples
    in help text and error messages. This allows command-line snippets to be
    displayed with distinct styling (cyan color in terminals) to make examples
    more visually clear.

     -  Added `commandLine()` function for creating command-line message terms.
     -  Updated `MessageTerm` type to include `commandLine` variant.
     -  Updated `formatMessage()` to support styling command-line examples.

[#5]: https://github.com/dahlia/optique/issues/5
[#30]: https://github.com/dahlia/optique/issues/30
[#31]: https://github.com/dahlia/optique/issues/31
[#33]: https://github.com/dahlia/optique/issues/33

### @optique/run

 -  Added completion integration to the `run()` function. Applications can
    now enable shell completion by setting the `completion` option, which
    automatically handles completion script generation and runtime completion
    requests.  [[#5]]

     -  Added `RunOptions.completion` option.


Version 0.5.3
-------------

Released on October 27, 2025.

### @optique/core

 -  Fixed incorrect CommonJS type export paths in `package.json`. The
    `"require"` type paths for submodules were incorrectly pointing to
    `"*.cts"` files instead of `"*.d.cts"` files, causing type resolution
    issues when importing submodules in CommonJS environments.  [[#36]]

### @optique/run

 -  Fixed incorrect CommonJS type export paths in `package.json`. The
    `"require"` type paths for submodules were incorrectly pointing to
    `"*.cts"` files instead of `"*.d.cts"` files, causing type resolution
    issues when importing submodules in CommonJS environments.  [[#36]]


Version 0.5.2
-------------

Released on October 8, 2025.

### @optique/run

 -  Fixed inconsistent error message coloring in Bun runtime by replacing
    reliance on default `console.error()` and `console.log()` with direct
    `process.stderr.write()` and `process.stdout.write()` calls. Previously,
    Bun's `console.error()` would add red coloring by default, which
    interfered with ANSI formatting in error messages. This change ensures
    consistent output formatting across all JavaScript runtimes (Node.js,
    Bun, and Deno).


Version 0.5.1
-------------

Released on September 26, 2025.

### @optique/core

 -  Fixed an issue where empty group sections were displayed in help output for
    nested subcommands. When using `group()` with nested commands, help text
    would show empty group headers when the grouped items were no longer
    available in the current command context. The `formatDocPage()` function
    now skips sections with no entries.  [[#29]]

[#29]: https://github.com/dahlia/optique/issues/29


Version 0.5.0
-------------

Released on September 23, 2025.

### @optique/core

 -  Refactored parser modules for better code organization by splitting the large
    `@optique/core/parser` module into focused, specialized modules. This
    improves maintainability, reduces module size, and provides clearer
    separation of concerns. All changes maintain full backward compatibility
    through re-exports.

     -  *Primitive parsers*: Moved primitive parsers (`constant()`, `option()`,
        `flag()`, `argument()`, `command()`) and their related types to
        a dedicated `@optique/core/primitives` module. These core building
        blocks are now logically separated from parser combinators.

     -  *Modifying combinators*: Moved parser modifier functions (`optional()`,
        `withDefault()`, `map()`, `multiple()`) and their related types to a
        dedicated `@optique/core/modifiers` module. These higher-order functions
        that transform and enhance parsers are now grouped together.

     -  *Construct combinators*: Moved parser combinators (`object()`,
        `tuple()`, `or()`, `merge()`, `concat()`, `longestMatch()`, `group()`)
        and their related types to a dedicated `@optique/core/constructs`
        module. These combinator functions that compose and combine parsers are
        now organized in a separate module.

    For backward compatibility, all functions continue to be re-exported from
    `@optique/core/parser`, so existing code will work unchanged. However, the
    recommended approach going forward is to import directly from the
    specialized modules:

    ~~~~ typescript
    // Recommended: import directly from specialized modules
    import { option, flag, argument } from "@optique/core/primitives";
    import { optional, withDefault, multiple } from "@optique/core/modifiers";
    import { object, or, merge } from "@optique/core/constructs";

    // Still supported: import everything from parser module (backward compatibility)
    import { option, flag, optional, withDefault, object, or } from "@optique/core/parser";
    ~~~~

    This refactoring only affects internal code organization and does not impact
    the public API or runtime behavior of any parsers.

 -  Added automatic error handling for `withDefault()` default value callbacks.
    When a default value callback throws an error, it is now automatically
    caught and converted to a parser-level error. This allows users to handle
    validation errors (like missing environment variables) directly at
    the parser level instead of after calling `run()`.  [[#18], [#21]]

 -  Added `WithDefaultError` class for structured error messages in
    `withDefault()` callbacks. This error type accepts a `Message` object
    instead of just a string, enabling rich formatting with colors and
    structured content in error messages. Regular errors are still supported and
    automatically converted to plain text messages.  [[#18], [#21]]

    ~~~~ typescript
    // Regular error (automatically converted to text)
    withDefault(option("--url", url()), () => {
      throw new Error("Environment variable not set");
    });

    // Structured error with rich formatting
    withDefault(option("--config", string()), () => {
      throw new WithDefaultError(
        message`Environment variable ${envVar("CONFIG_PATH")} is not set`
      );
    });
    ~~~~

 -  Added `envVar` message term type for environment variable references.
    Environment variables are displayed with bold and underline formatting
    to distinguish them from other message components like option names
    and metavariables.  The `envVar()` helper function creates environment
    variable terms for use in structured messages.

    ~~~~ typescript
    import { envVar, message } from "@optique/core/message";

    const configError = message`Environment variable ${envVar("API_URL")} is not set.`;
    // Displays: Environment variable API_URL is not set. (bold + underlined)
    ~~~~

 -  Added custom help display messages for `withDefault()` parsers. The
    `withDefault()` modifier now accepts an optional third parameter to
    customize how default values are displayed in help text. This allows
    showing descriptive text instead of actual default values, which is
    particularly useful for environment variables, computed defaults, or
    sensitive information.  [[#19]]

    ~~~~ typescript
    import { message, envVar } from "@optique/core/message";
    import { withDefault } from "@optique/core/parser";

    // Show custom help text instead of actual values
    const parser = object({
      apiUrl: withDefault(
        option("--api-url", url()),
        new URL("https://api.example.com"),
        { message: message`Default API endpoint` }
      ),
      token: withDefault(
        option("--token", string()),
        () => process.env.API_TOKEN || "",
        { message: message`${envVar("API_TOKEN")}` }
      )
    });

    // Help output shows: --token STRING [API_TOKEN]
    // Instead of the actual token value
    ~~~~

 -  Enhanced `formatMessage()` with `resetSuffix` support for better ANSI color
    handling. The `colors` option can now be an object with a `resetSuffix`
    property that maintains parent styling context after ANSI reset sequences.
    This fixes issues where dim styling was interrupted by inner ANSI codes
    in default value display.  [[#19]]

    ~~~~ typescript
    formatMessage(msg, {
      colors: { resetSuffix: "\x1b[2m" },  // Maintains dim after resets
      quotes: false
    });
    ~~~~

 -  Updated `DocEntry.default` field type from `string` to `Message` for rich
    formatting support in documentation. This change enables structured default
    value display with colors, environment variables, and other message
    components while maintaining full backward compatibility.  [[#19]]

 -  Added comprehensive error message customization system that allows
    users to customize error messages for all parser types and combinators.
    This addresses the need for better user-facing error messages in CLI
    applications by enabling context-specific error text with support for
    both static messages and dynamic error generation functions.  [[#27]]

     -  Parser error options: All primitive parsers (`option()`, `flag()`,
        `argument()`, `command()`) now accept an `errors` option to customize
        error messages:

        ~~~~ typescript
        const parser = option("--port", integer(), {
          errors: {
            missing: message`Port number is required for server operation.`,
            invalidValue: (error) => message`Invalid port: ${error}`
          }
        });
        ~~~~

     -  Combinator error options: Parser combinators (`or()`, `longestMatch()`,
        `object()`, `multiple()`) support error customization for various
        failure scenarios:

        ~~~~ typescript
        const parser = or(
          flag("--verbose"),
          flag("--quiet"),
          {
            errors: {
              noMatch: message`Please specify either --verbose or --quiet.`
            }
          }
        );
        ~~~~

     -  Value parser error customization: All value parsers now support
        customizable error messages through an `errors` option in their
        configuration. This enables application-specific error messages
        that better guide users:

        ~~~~ typescript
        // Core value parsers
        const portOption = option("--port", integer({
          min: 1024,
          max: 65535,
          errors: {
            invalidInteger: message`Port must be a whole number.`,
            belowMinimum: (value, min) =>
              message`Port ${text(value.toString())} too low. Use ${text(min.toString())} or higher.`,
            aboveMaximum: (value, max) =>
              message`Port ${text(value.toString())} too high. Maximum is ${text(max.toString())}.`
          }
        }));

        const formatOption = option("--format", choice(["json", "yaml", "xml"], {
          errors: {
            invalidChoice: (input, choices) =>
              message`Format ${input} not supported. Available: ${values(choices)}.`
          }
        }));
        ~~~~

     -  Function-based error messages: Error options can be functions that
        receive context parameters to generate dynamic error messages:

        ~~~~ typescript
        const parser = command("deploy", argument(string()), {
          errors: {
            notMatched: (expected, actual) =>
              message`Expected "${expected}" command, but got "${actual ?? "nothing"}".`
          }
        });
        ~~~~

     -  Type-safe error interfaces: Each parser type has its own error
        options interface (`OptionErrorOptions`, `FlagErrorOptions`,
        `ArgumentErrorOptions`, `CommandErrorOptions`, `ObjectOptions`,
        `MultipleOptions`, `OrOptions`, `LongestMatchOptions`) providing
        IntelliSense support and type safety.

     -  Improved default messages: Default error messages have been improved
        to be more user-friendly, changing generic messages like “No parser
        matched” to specific ones like “No matching option or command
        found.”

     -  Backward compatibility: All error customization is optional and
        maintains full backward compatibility. Existing code continues to work
        unchanged while new APIs are available when needed.

[#18]: https://github.com/dahlia/optique/discussions/18
[#19]: https://github.com/dahlia/optique/issues/19
[#21]: https://github.com/dahlia/optique/issues/21
[#27]: https://github.com/dahlia/optique/issues/27

### @optique/run

 -  Added comprehensive error message customization for the `path()` value
    parser. Path validation now supports custom error messages for all
    validation scenarios, enabling more user-friendly error messages in
    file and directory operations:

    ~~~~ typescript
    import { path } from "@optique/run/valueparser";
    import { message, values } from "@optique/core/message";

    // Configuration file with custom validation errors
    const configFile = option("--config", path({
      mustExist: true,
      type: "file",
      extensions: [".json", ".yaml", ".yml"],
      errors: {
        pathNotFound: (input) =>
          message`Configuration file ${input} not found.`,
        notAFile: message`Configuration must be a file, not a directory.`,
        invalidExtension: (input, extensions, actualExt) =>
          message`Config file ${input} has wrong extension ${actualExt}. Expected: ${values(extensions)}.`,
      }
    }));
    ~~~~

    The `PathOptions` interface now includes an `errors` field with support
    for customizing `pathNotFound`, `notAFile`, `notADirectory`,
    `invalidExtension`, and `parentNotFound` error messages. All error
    customization options support both static `Message` objects and dynamic
    functions that receive validation context parameters.  [[#27]]

### @optique/temporal

 -  Added comprehensive error message customization for all temporal value
    parsers. This enables application-specific error messages for date, time,
    and timezone validation scenarios:

    ~~~~ typescript
    import { instant, duration, timeZone } from "@optique/temporal";
    import { message } from "@optique/core/message";

    // Timestamp parser with user-friendly errors
    const startTime = option("--start", instant({
      errors: {
        invalidFormat: (input) =>
          message`Start time ${input} is invalid. Use ISO 8601 format like 2023-12-25T10:30:00Z.`,
      }
    }));

    // Duration parser with contextual errors
    const timeout = option("--timeout", duration({
      errors: {
        invalidFormat: message`Timeout must be in ISO 8601 duration format (e.g., PT30S, PT5M, PT1H).`,
      }
    }));

    // Timezone parser with helpful suggestions
    const timezone = option("--timezone", timeZone({
      errors: {
        invalidFormat: (input) =>
          message`Timezone ${input} is not valid. Use IANA identifiers like America/New_York or UTC.`,
      }
    }));
    ~~~~

    All temporal parsers (`instant()`, `duration()`, `zonedDateTime()`,
    `plainDate()`, `plainTime()`, `plainDateTime()`, `plainYearMonth()`,
    `plainMonthDay()`, `timeZone()`) now support an `errors` option with
    `invalidFormat` error message customization. This maintains consistency
    with the error customization system across all Optique packages.  [[#27]]


Version 0.4.4
-------------

Released on September 18, 2025.

### @optique/core

 -  Fixed subcommand help display bug in the `run()` function when using
    the `help` option. Previously, `cli my-cmd --help` would incorrectly
    show root-level help instead of subcommand-specific help when parsers
    were combined with `or()`. Now `--help` correctly shows help for the
    specific subcommand being used.  [[#26]]

[#26]: https://github.com/dahlia/optique/issues/26


Version 0.4.3
-------------

Released on September 16, 2025.

### @optique/temporal

 -  Fixed timezone identifier validation failure in Deno 2.5.0. The `timeZone()`
    parser now works correctly with all supported timezones by removing explicit
    zero values for hour, minute, and second fields when creating validation
    `ZonedDateTime` objects. This addresses a regression in Deno 2.5.0's
    Temporal API implementation that rejected zero values for time fields.


Version 0.4.2
-------------

Released on September 10, 2025.

### @optique/run

 -  Fixed dependency resolution bug where *@optique/core* dependency was not
    properly versioned, causing installations to use outdated stable versions
    instead of matching development versions. This resolves type errors and
    message formatting issues when using dev versions.  [[#22]]

[#22]: https://github.com/dahlia/optique/issues/22


Version 0.4.1
-------------

Released on September 8, 2025.

### @optique/run

 -  Fixed inconsistent error message coloring across JavaScript runtimes
    by replacing `console.error()` and `console.log()` with direct
    `process.stderr.write()` and `process.stdout.write()` calls.
    Previously, runtimes like Bun would display `console.error()` output
    in red, causing ANSI reset codes in formatted option names to interrupt
    the error coloring. This change ensures consistent output formatting
    across all JavaScript runtimes.  [[#20]]

[#20]: https://github.com/dahlia/optique/issues/20


Version 0.4.0
-------------

Released on September 6, 2025.

### @optique/core

 -  Improved type inference for `tuple()` parser by using `const` type
    parameter. The generic type parameter now preserves tuple literal types
    more accurately, providing better type safety and inference when working
    with tuple parsers.

 -  Extended `merge()` combinator to support up to 10 parsers (previously
    limited to 5), allowing more complex CLI configurations with larger numbers
    of parsers to be combined into a single object structure.

 -  Added optional label parameter to `merge()` combinator for better help text
    organization. Similar to `object()`, `merge()` now accepts an optional first
    string parameter to label the merged group in documentation:

    ~~~~ typescript
    // Without label (existing usage)
    merge(apiParser, dbParser, serverParser)

    // With label (new feature)
    merge("Configuration", apiParser, dbParser, serverParser)
    ~~~~

    This addresses the inconsistency where developers had to choose between
    clean code structure using `merge()` or organized help output using labeled
    `object()` calls. The label appears as a section header in help text,
    making it easier to group related options from multiple parsers.  [[#12]]

 -  Added `group()` combinator for organizing any parser under a labeled section
    in help text. This wrapper function applies a group label to any parser for
    documentation purposes without affecting parsing behavior:

    ~~~~ typescript
    // Group mutually exclusive options
    const outputFormat = group(
      "Output Format",
      or(
        map(flag("--json"), () => "json"),
        map(flag("--yaml"), () => "yaml"),
        map(flag("--xml"), () => "xml"),
      ),
    );
    ~~~~

    Unlike `merge()` and `object()` which have built-in label support, `group()`
    can be used with any parser type (`or()`, `flag()`, `multiple()`, etc.) that
    doesn't natively support labeling. This enables clean code organization
    while maintaining well-structured help text.  [[#12]]

 -  Improved type safety for `merge()` combinator by enforcing stricter
    parameter constraints. The function now rejects parsers that return
    non-object values (arrays, primitives, etc.) at compile time,
    producing clear “No overload matches this call” errors instead of
    allowing invalid combinations that would fail at runtime:

    ~~~~ typescript
    // These now produce compile-time errors (previously allowed):
    merge(
      object({ port: option("--port", integer()) }),  // ✅ Returns object
      multiple(argument(string())),                   // ❌ Returns array
    );

    merge(
      object({ verbose: flag("--verbose") }),         // ✅ Returns object
      flag("--debug"),                                // ❌ Returns boolean
    );
    ~~~~

    This prevents a class of runtime errors where `merge()` would receive
    incompatible parser types. Existing code using `merge()` with only
    object-producing parsers (the intended usage) continues to work unchanged.

 -  Improved help and version handling in `run()` function with better edge case
    support and more consistent behavior. The implementation was refactored from
    a complex conditional parser generator into modular helper functions,
    improving maintainability and test coverage:

     -  Enhanced last-option-wins pattern: `--version --help` shows help,
        `--help --version` shows version
     -  Added support for options terminator (`--`) to prevent help/version
        flags after `--` from being interpreted as options
     -  Improved handling of multiple identical flags
        (e.g., `--version --version`)

    The public API remains unchanged - existing `run()` usage continues to work
    identically while benefiting from more robust edge case handling.  [[#13]]

 -  Added `showDefault` option to display default values in help text. When
    enabled, options and arguments created with `withDefault()` will display
    their default values in the help output:

    ~~~~ typescript
    const parser = object({
      port: withDefault(option("--port", integer()), 3000),
      format: withDefault(option("--format", string()), "json"),
    });

    // Basic usage shows: --port [3000], --format [json]
    formatDocPage("myapp", doc, { showDefault: true });

    // Custom formatting
    formatDocPage("myapp", doc, {
      showDefault: { prefix: " (default: ", suffix: ")" }
    });
    // Shows: --port (default: 3000), --format (default: json)
    ~~~~

    The feature is opt-in and backward compatible. Default values are
    automatically dimmed when colors are enabled. A new `ShowDefaultOptions`
    interface provides type-safe customization of the display format.  [[#14]]

 -  Added `brief`, `description`, and `footer` options to the `RunOptions`
    interface in the `run()` function. These fields allow users to provide
    rich documentation that appears in help text without modifying parser
    definitions:

    ~~~~ typescript
    import { run } from "@optique/core/facade";
    import { message } from "@optique/core/message";

    run(parser, "myapp", args, {
      brief: message`A powerful CLI tool for data processing`,
      description: message`This tool provides comprehensive data processing
        capabilities with support for multiple formats and transformations.`,
      footer: message`For more information, visit https://example.com`,
      help: { mode: "option" },
    });
    ~~~~

    The documentation fields appear in both help output (when `--help` is used)
    and error output (when `aboveError: "help"` is configured). These options
    augment the `DocPage` generated by `getDocPage()`, with user-provided values
    taking precedence over parser-generated content.  [[#15]]

[#12]: https://github.com/dahlia/optique/issues/12
[#13]: https://github.com/dahlia/optique/issues/13
[#14]: https://github.com/dahlia/optique/issues/14
[#15]: https://github.com/dahlia/optique/issues/15

### @optique/run

 -  Added `showDefault` option to the `RunOptions` interface. This option works
    identically to the same option in `@optique/core/facade`, allowing users
    to display default values in help text when using the process-integrated
    `run()` function:

    ~~~~ typescript
    import { run } from "@optique/run";

    const result = run(parser, {
      showDefault: true,  // Shows default values in help
      colors: true,       // With dim styling
    });
    ~~~~

    This ensures feature parity between the low-level facade API and the
    high-level run package.  [[#14]]

 -  Added `brief`, `description`, and `footer` options to the `RunOptions`
    interface. These fields provide the same rich documentation capabilities
    as the corresponding options in `@optique/core/facade`, but with the
    convenience of automatic process integration:

    ~~~~ typescript
    import { run } from "@optique/run";
    import { message } from "@optique/core/message";

    const result = run(parser, {
      brief: message`A powerful CLI tool for data processing`,
      description: message`This tool provides comprehensive data processing
        capabilities with support for multiple formats and transformations.`,
      footer: message`For more information, visit https://example.com`,
      help: "option",  // Enables --help option
      version: "1.0.0", // Enables --version option
    });
    ~~~~

    This maintains feature parity between the low-level facade API and the
    high-level run package, allowing developers to create rich CLI documentation
    regardless of which API they use.  [[#15]]

### @optique/temporal

The *@optique/temporal* package was introduced in this release, providing
parsers for JavaScript Temporal types. This package depends on
the *@js-temporal/polyfill* package for environments that do not yet
support Temporal natively.

 -  Added `TimeZone` type.
 -  Added `instant()` value parser.
 -  Added `InstantOptions` interface.
 -  Added `duration()` value parser.
 -  Added `DurationOptions` interface.
 -  added `zonedDateTime()` value parser.
 -  Added `ZonedDateTimeOptions` interface.
 -  Added `plainDate()` value parser.
 -  Added `PlainDateOptions` interface.
 -  Added `plainTime()` value parser.
 -  Added `PlainTimeOptions` interface.
 -  Added `plainDateTime()` value parser.
 -  Added `PlainDateTimeOptions` interface.
 -  Added `plainYearMonth()` value parser.
 -  Added `PlainYearMonthOptions` interface.
 -  Added `plainMonthDay()` value parser.
 -  Added `PlainMonthDayOptions` interface.
 -  Added `timeZone()` value parser.
 -  Added `TimeZoneOptions` interface.


Version 0.3.2
-------------

Released on September 10, 2025.

### @optique/run

 -  Fixed dependency resolution bug where *@optique/core* dependency was not
    properly versioned, causing installations to use outdated stable versions
    instead of matching development versions. This resolves type errors and
    message formatting issues when using dev versions.  [[#22]]


Version 0.3.1
-------------

Released on September 8, 2025.

### @optique/run

 -  Fixed inconsistent error message coloring across JavaScript runtimes
    by replacing `console.error()` and `console.log()` with direct
    `process.stderr.write()` and `process.stdout.write()` calls.
    Previously, runtimes like Bun would display `console.error()` output
    in red, causing ANSI reset codes in formatted option names to interrupt
    the error coloring. This change ensures consistent output formatting
    across all JavaScript runtimes.  [[#20]]


Version 0.3.0
-------------

Released on August 29, 2025.

### @optique/core

 -  Added `flag()` parser for creating required Boolean flags that must be
    explicitly provided. Unlike `option()` which defaults to `false` when
    not present, `flag()` fails parsing when not provided, making it useful
    for dependent options and conditional parsing scenarios.

 -  Extended `or()` combinator to support up to 10 parsers (previously limited
    to 5), enabling more complex command-line interfaces with larger numbers
    of mutually exclusive subcommands or options.

 -  Enhanced `withDefault()` to support union types when the default value
    is a different type from the parser result. The result type is now
    `T | TDefault` instead of requiring the default to match the parser type.
    This enables patterns like conditional CLI structures with dependent
    options where different default structures are needed based on flag states.

 -  Modified `object()` parser to use greedy parsing behavior. The parser now
    attempts to consume all matching fields in a single parse call, rather than
    returning after the first successful field match. This enables dependent
    options patterns where multiple related options need to be parsed together
    (e.g., `--flag --dependent-option`). While this change maintains backward
    compatibility for most use cases, it may affect performance and parsing
    order in complex scenarios.

 -  Enhanced `merge()` combinator type constraints to accept any parser that
    produces object-like values, not just `object()` parsers. This enables
    combining `withDefault()`, `map()`, and other parsers that generate objects
    with `merge()`. The combinator also now properly supports parsers with
    different state management strategies using specialized state handling to
    preserve the expected state format for each parser type.

 -  Modified `Parser.getDocFragments()` method signature to use
    `DocState<TState>` discriminated union instead of direct state values.
    The new signature is `getDocFragments(state: DocState<TState>, ...args)`.
    This change improves type safety by explicitly modeling when parser state
    is available versus unavailable, fixing crashes in help generation when
    using `merge()` with `or()` combinations. This only affects advanced users
    who directly call `getDocFragments()` or implement custom parsers.

     -  Added `DocState` type.
     -  Changed the type of `Parser.getDocFragments()`'s first parameter
        from `TState` to `DocState<TState>`.

 -  Added `longestMatch()` combinator that selects the parser which consumes
    the most input tokens. Unlike `or()` which returns the first successful
    match, `longestMatch()` tries all provided parsers and chooses the one
    with the longest match. This enables context-aware parsing where more
    specific patterns take precedence over general ones, making it ideal for
    implementing sophisticated help systems where `command --help` shows
    command-specific help rather than global help. The combinator supports
    function overloads for 2–5 parsers plus a variadic version, with full
    type inference for discriminated union results.

 -  Modified `run()` function in `@optique/core/facade` to use `longestMatch()`
    instead of `or()` for help parsing. This enables context-aware help behavior
    where `subcommand --help` shows help specific to that command instead of
    global help. For example, `myapp list --help` now displays help for
    the `list` command rather than the global application help.
    This change affects all help modes (`"command"`, `"option"`, and
    `"both"`). Applications using the `run()` function will automatically
    benefit from improved help UX without code changes.

 -  Refactored `run()` function help API to group related options together for
    better type safety. The new API prevents invalid combinations and provides
    a cleaner interface:

    ~~~~ typescript
    run(parser, args, {
      help: {
        mode: "both",           // "command" | "option" | "both"
        onShow: process.exit,   // Optional callback
      }
    });
    ~~~~

 -  Added `version` functionality to the `run()` function, supporting both
    `--version` option and `version` command modes:

    ~~~~ typescript
    run(parser, args, {
      version: {
        mode: "option",         // "command" | "option" | "both"
        value: "1.0.0",         // Version string to display
        onShow: process.exit,   // Optional callback
      }
    });
    ~~~~

    The `version` configuration follows the same pattern as `help`, with
    three modes:

     -  `"option"`: Only `--version` flag is available
     -  `"command"`: Only `version` subcommand is available
     -  `"both"`: Both `--version` and `version` subcommand work

### @optique/run

 -  The `run()` function now provides context-aware help behavior,
    automatically inheriting the improvements from `@optique/core/facade`.
    Applications using `@optique/run` will see the same enhanced help system
    where `subcommand --help` shows command-specific help instead of global
    help.

 -  Simplified help API by removing the `"none"` option.
    Since disabling help can be achieved by simply omitting the `help` option,
    the explicit `"none"` value is no longer needed:

    ~~~~ typescript
    // Old API
    run(parser, { help: "none" }); // Explicitly disable help
    run(parser, { help: "both" }); // Enable help

    // New API
    run(parser, {}); // Help disabled (omit the option)
    run(parser, { help: "both" }); // Enable help: "command" | "option" | "both"
    ~~~~

    The help option now only accepts `"command" | "option" | "both"`. To
    disable help functionality, simply omit the `help` option entirely.

 -  Added `version` functionality with a flexible API that supports both
    simple string and detailed object configurations:

    ~~~~ typescript
    // Simple version configuration (uses default "option" mode)
    run(parser, { version: "1.0.0" });

    // Advanced version configuration
    run(parser, {
      version: {
        value: "1.0.0",
        mode: "both"  // "command" | "option" | "both"
      }
    });
    ~~~~

    The version functionality automatically calls `process.exit(0)` when
    version information is requested, making it suitable for CLI applications
    that need to display version and exit.

 -  Added structured message output functions for CLI applications with
    automatic terminal detection and consistent formatting:

     -  Added `print()` function for general output to stdout.
     -  Added `printError()` function for error output to stderr with automatic
        `Error: ` prefix and optional process exit.
     -  Added `createPrinter()` function for custom output scenarios with
        predefined formatting options.
     -  Added `PrintOptions` and `PrintErrorOptions` interfaces for type-safe
        configuration.
     -  Added `Printer` type for custom printer functions.

    All output functions automatically detect terminal capabilities (colors,
    width) and format structured messages consistently across different
    environments.


Version 0.2.1
-------------

Released on September 9, 2025.

### @optique/run

 -  Fixed dependency resolution bug where *@optique/core* dependency was not
    properly versioned, causing installations to use outdated stable versions
    instead of matching development versions. This resolves type errors and
    message formatting issues when using dev versions.  [[#22]]


Version 0.2.0
-------------

Released on August 22, 2025.

### @optique/core

 -  Added `concat()` function for concatenating multiple `tuple()` parsers into
    a single flattened tuple, similar to how `merge()` works for `object()`
    parsers. [[#1]]

 -  Fixed an infinite loop issue in the main parsing loop that could occur when
    parsers succeeded but didn't consume input.

 -  Fixed bundled short options (e.g., `-vdf` for `-v -d -f`) not being parsed
    correctly in some cases.

[#1]: https://github.com/dahlia/optique/issues/1


Version 0.1.2
-------------

Released on September 9, 2025.

### @optique/run

 -  Fixed dependency resolution bug where *@optique/core* dependency was not
    properly versioned, causing installations to use outdated stable versions
    instead of matching development versions. This resolves type errors and
    message formatting issues when using dev versions.  [[#22]]


Version 0.1.1
-------------

Released on August 21, 2025.

### @optique/core

 -  Fixed a bug where `object()` parsers containing only Boolean flags would
    fail when no arguments were provided, instead of defaulting the flags to
    `false`. [[#6]]

[#6]: https://github.com/dahlia/optique/issues/6


Version 0.1.0
-------------

Released on August 21, 2025.  Initial release.
