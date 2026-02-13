---
description: >-
  Learn how to add shell completion support to your CLI applications using
  Optique's built-in completion system. Covers Bash and zsh integration,
  custom suggestions, and native file completion.
---

Shell completion
================

*This API is available since Optique 0.6.0.*

Shell completion enhances command-line user experience by providing
intelligent suggestions for commands, options, and arguments as users type.
Optique provides built-in completion support for Bash, zsh, fish, PowerShell,
and Nushell that integrates seamlessly with the existing parser architecture.

Unlike many CLI frameworks that require separate completion definitions,
Optique's completion system leverages the same parser structure used for
argument parsing. This eliminates code duplication and ensures completion
suggestions stay synchronized with your CLI's actual behavior.


How completion works
--------------------

Optique's completion system operates through three key components:

`Parser.suggest()` methods
:   Each parser provides completion suggestions based on the current parsing
    context

Shell script generation
:   Optique generates completion scripts for Bash and zsh that integrate
    with shell completion systems

Runtime completion
:   Your application automatically handles completion requests triggered by
    the generated scripts

When a user presses Tab, the shell calls your application with special
arguments that Optique intercepts. Your parsers provide suggestions for the
current context, which are then filtered and displayed by the shell.

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { argument, option } from "@optique/core/primitives";
import { string, choice } from "@optique/core/valueparser";
import { run } from "@optique/run";

const parser = object({
  format: option("-f", "--format", choice(["json", "yaml", "xml"])),
  input: argument(string({ metavar: "FILE" })),
});

// Enable completion with a single option
const config = run(parser, { completion: "both" });
~~~~

Users can then generate and install completion scripts:

::: code-group

~~~~ bash [Bash]
myapp completion bash > ~/.bashrc.d/myapp.bash
source ~/.bashrc.d/myapp.bash
~~~~

~~~~ zsh [zsh]
myapp completion zsh > ~/.zsh/completions/_myapp
~~~~

~~~~ fish [fish]
myapp completion fish > ~/.config/fish/completions/myapp.fish
~~~~

~~~~ powershell [PowerShell]
myapp completion pwsh > $PROFILE/../myapp-completion.ps1
Add-Content $PROFILE ". $PROFILE/../myapp-completion.ps1"
~~~~

~~~~ nushell [Nushell]
myapp completion nu | save myapp-completion.nu
source myapp-completion.nu
~~~~

:::


The `Suggestion` type
---------------------

Optique uses a discriminated union to represent different types of completion
suggestions:

~~~~ typescript twoslash
import type { Message } from "@optique/core/message";
// ---cut-before---
export type Suggestion =
  | {
      readonly kind: "literal";
      readonly text: string;
      readonly description?: Message;
    }
  | {
      readonly kind: "file";
      readonly pattern?: string;
      readonly type: "file" | "directory" | "any";
      readonly extensions?: readonly string[];
      readonly includeHidden?: boolean;
      readonly description?: Message;
    };
~~~~

### Literal suggestions

Literal suggestions provide exact text completions for things like option
names, subcommands, or predefined values:

~~~~ typescript twoslash
import { type Parser, suggest } from "@optique/core/parser";
const parser = {} as unknown as Parser<"sync", unknown, unknown>;
// ---cut-before---
// Suggests: ["--format", "--input", "--help"]
const suggestions = suggest(parser, ["--"]);
~~~~

### File suggestions

File suggestions delegate completion to the shell's native file system
integration. This provides better performance and handles platform-specific
behaviors like symlinks, permissions, and hidden files:

~~~~ typescript twoslash
import { argument } from "@optique/core/primitives";
import { path } from "@optique/run/valueparser";
// ---cut-before---
// Uses shell's native file completion
const fileParser = argument(path({ extensions: [".json", ".yaml"] }));
~~~~


`Parser.suggest()` methods
--------------------------

All Optique parsers implement an optional `suggest()` method that provides
context-aware completion suggestions. Parser combinators automatically
compose suggestions from their constituent parsers.

### Primitive parser suggestions

Primitive parsers provide suggestions based on their specific roles:

~~~~ typescript twoslash
import { type Parser, suggest } from "@optique/core/parser";
import { argument, command, option } from "@optique/core/primitives";
import { choice } from "@optique/core/valueparser";
const parser = {} as unknown as Parser<"sync", unknown, unknown>;
// ---cut-before---
// Option parsers suggest their names
suggest(option("-v", "--verbose"), ["--v"]);
// Returns: [{ kind: "literal", text: "--verbose" }]

// Command parsers suggest their command names
suggest(command("build", parser), ["bu"]);
// Returns: [{ kind: "literal", text: "build" }]

// Argument parsers delegate to their value parsers
suggest(argument(choice(["start", "stop"])), ["st"]);
// Returns: [{ kind: "literal", text: "start" }, { kind: "literal", text: "stop" }]
~~~~

### Combinator composition

Parser combinators automatically combine suggestions from their constituent
parsers:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { suggest } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { choice } from "@optique/core/valueparser";
// ---cut-before---
const parser = object({
  action: option("-a", "--action", choice(["start", "stop"])),
  verbose: option("-v", "--verbose"),
});

// Suggests all available options
suggest(parser, ["--"]);
// Returns: ["--action", "--verbose", "--help"]

// Suggests values for specific options
suggest(parser, ["--action", "st"]);
// Returns: ["start", "stop"]
~~~~

### Context-aware suggestions

The `suggest()` method receives the current parsing context, allowing for
sophisticated completion logic:

~~~~ typescript twoslash
import { object, or } from "@optique/core/constructs";
import { suggest } from "@optique/core/parser";
import { argument, constant } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { path } from "@optique/run/valueparser";
// ---cut-before---
// Suggests different options based on what's already parsed
const parser = or(
  object({ command: constant("build"), target: argument(string()) }),
  object({ command: constant("test"), file: argument(path()) })
);

suggest(parser, ["build", ""]);
// Suggests completions for 'target' argument

suggest(parser, ["test", ""]);
// Suggests completions for 'file' argument
~~~~


`ValueParser.suggest()` methods
-------------------------------

Value parsers provide domain-specific completion suggestions for their
respective data types. Optique includes several built-in value parsers with
intelligent completion support.

### Built-in value parser suggestions

~~~~ typescript twoslash
import { choice, locale, url } from "@optique/core/valueparser";
import { timeZone } from "@optique/temporal";
// ---cut-before---
// URL parser suggests protocol completions
const urlParser = url({ allowedProtocols: ["https:", "http:", "ftp:"] });
urlParser.suggest?.("ht");
// Returns: ["http://", "https://"]

// Choice parser suggests available options
const formatParser = choice(["json", "yaml", "xml"]);
formatParser.suggest?.("j");
// Returns: ["json"]

// Locale parser suggests common locale identifiers
const localeParser = locale();
localeParser.suggest?.("en");
// Returns: ["en", "en-US", "en-GB", "en-CA", ...]

// Timezone parser uses Intl.supportedValuesOf for dynamic suggestions
const timezoneParser = timeZone();
timezoneParser.suggest?.("America/");
// Returns: ["America/New_York", "America/Chicago", ...]
~~~~

### Custom value parser suggestions

You can implement `suggest()` methods in custom value parsers:

~~~~ typescript twoslash
// @noErrors: 2322
import type { ValueParser } from "@optique/core/valueparser";
// ---cut-before---
function customParser(): ValueParser<"sync", string> {
  return {
    $mode: "sync",
    metavar: "CUSTOM",
    parse(input) {
      // Parsing logic...
    },
    format(value) {
      return value;
    },
    *suggest(prefix) {
      const options = ["option1", "option2", "option3"];
      for (const option of options) {
        if (option.startsWith(prefix.toLowerCase())) {
          yield { kind: "literal", text: option };
        }
      }
    },
  };
}
~~~~


Shell script generation
-----------------------

Optique generates completion scripts that integrate with each shell's native
completion system. The generated scripts handle the complexity of shell
integration while delegating suggestion logic to your application.

### Bash completion

Bash completion scripts use the `complete` command to register completion
functions. The generated script handles:

 -  Option and command name completion
 -  Value completion for options with `=` syntax
 -  Native file completion using `compgen`
 -  Proper handling of special characters and spaces

### zsh completion

zsh completion scripts use the `compdef` system and `_describe` function for
rich completion display. The generated script supports:

 -  Completion descriptions displayed alongside suggestions
 -  Native file completion using `_files`
 -  Advanced completion contexts and filtering
 -  Integration with zsh's completion styling system

### fish completion

fish completion scripts use a function-based approach with the `complete`
command. The generated script provides:

 -  Tab-separated completion descriptions (`value\tdescription` format)
 -  Automatic argument parsing using `commandline` utility
 -  Native file completion using fish globbing and string matching
 -  Extension filtering and hidden file handling
 -  Auto-loading from *~/.config/fish/completions/* directory

### PowerShell completion

PowerShell completion scripts use `Register-ArgumentCompleter` with the
`-Native` parameter to integrate with PowerShell's completion system. The
generated script provides:

 -  AST-based argument extraction for robust parsing
 -  `CompletionResult` objects with descriptions and tooltips
 -  Native file completion using `Get-ChildItem`
 -  Support for hidden files and extension filtering
 -  Cross-platform compatibility (Windows, Linux, macOS)

### Nushell completion

Nushell completion scripts use the `$env.config.completions.external.completer`
system to provide completions for external commands. The generated script
provides:

 -  Custom completer registration that integrates with Nushell's completion system
 -  Context-aware completion using custom argument parsing
 -  Structured data return values with `value` and `description` fields
 -  Native file completion using Nushell's `ls` command and `match` expressions
 -  Tab-separated encoding format for CLI communication
 -  Support for file type filtering and hidden file handling
 -  Automatic preservation of existing completers for other commands


Integration with `run()`
------------------------

The `run()` function from *@optique/run* provides seamless completion
integration. Enable completion by adding the `completion` option to your
`run()` configuration.

### Completion configuration

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { argument, option } from "@optique/core/primitives";
import { string, choice } from "@optique/core/valueparser";
import { run } from "@optique/run";

const parser = object({
  format: option("-f", "--format", choice(["json", "yaml"])),
  input: argument(string()),
});

const config = run(parser, { completion: "both" });
~~~~

### Completion modes

The `mode` option controls how completion is triggered:

`"command"`
:   Completion via subcommand (`myapp completion bash`)

`"option"`
:   Completion via option (`myapp --completion bash`)

`"both"`
:   Both command and option patterns supported

### Naming conventions

*This API is available since Optique 0.7.0.*

You can configure whether to use singular (`completion`), plural
(`completions`), or both naming conventions for the completion command and
option:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { run } from "@optique/run";

const parser = object({});

const config = run(parser, {
  completion: {
    mode: "both",
    name: "plural", // Use "completions" and "--completions"
  }
});
~~~~

The `name` option accepts:

`"singular"`
:   Use `completion` command and `--completion` option.

`"plural"`
:   Use `completions` command and `--completions` option.

`"both"` (default)
:   Use both singular and plural forms.

### Help visibility

*This API is available since Optique 0.10.0.*

You can control which completion aliases appear in help and usage output with
`helpVisibility`. This is useful when you want to keep compatibility aliases
working without showing all aliases in `--help`.

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { run } from "@optique/run";

const parser = object({});

run(parser, {
  completion: {
    mode: "both",
    name: "both", // Accept both completion/completions at runtime
    helpVisibility: "singular", // Show only singular form in help output
  },
});
~~~~

The `helpVisibility` option accepts:

`"singular"`
:   Show only `completion` and `--completion` in help/usage.

`"plural"`
:   Show only `completions` and `--completions` in help/usage.

`"both"`
:   Show both singular and plural forms.

`"none"`
:   Hide completion command and option entries from help/usage.

### Automatic handling

When completion is enabled, the `run()` function automatically:

 -  Detects completion requests before normal argument parsing
 -  Generates shell scripts when requested
 -  Provides runtime completion suggestions
 -  Handles output formatting for each shell
 -  Exits with appropriate status codes

### Custom shell support

By default, Optique provides completion for Bash, zsh, fish, PowerShell, and
Nushell. You can add custom shell completions or override the defaults using
the `shells` option:

~~~~ typescript twoslash
import type { ShellCompletion } from "@optique/core/completion";
import { object } from "@optique/core/constructs";
import { argument } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { run } from "@optique/run";

const parser = object({
  name: argument(string()),
});

// Create a custom shell completion
const customShell: ShellCompletion = {
  name: "custom",
  generateScript(programName: string, args: readonly string[] = []): string {
    return `# Custom shell completion script for ${programName}`;
  },
  *encodeSuggestions(suggestions) {
    for (const suggestion of suggestions) {
      if (suggestion.kind === "literal") {
        yield `${suggestion.text}\n`;
      }
    }
  },
};

run(parser, {
  completion: {
    mode: "both",
    shells: { custom: customShell }, // Add custom shell
  },
});
~~~~

The custom shell completion will be merged with the default shells, making
all shells available. You can also override default shells by using the same
name (e.g., `bash`, `zsh`, `fish`, `pwsh`, or `nu`).


Setup instructions
------------------

Follow these steps to add shell completion to your CLI application:

### 1. Enable completion in your application

~~~~ typescript twoslash
import type { Parser } from "@optique/core/parser";
const parser = {} as unknown as Parser<"sync", unknown, unknown>;
// ---cut-before---
import { run } from "@optique/run";

const config = run(parser, { completion: "both" });
~~~~

### 2. Generate completion scripts

Users can generate completion scripts for their preferred shell:

::: code-group

~~~~ bash [Bash]
myapp completion bash > ~/.bashrc.d/myapp.bash
~~~~

~~~~ zsh [zsh]
myapp completion zsh > ~/.zsh/completions/_myapp
# or
myapp completion zsh > ~/.oh-my-zsh/completions/_myapp
~~~~

~~~~ fish [fish]
myapp completion fish > ~/.config/fish/completions/myapp.fish
~~~~

~~~~ powershell [PowerShell]
myapp completion pwsh > myapp-completion.ps1
~~~~

~~~~ nushell [Nushell]
myapp completion nu | save myapp-completion.nu
~~~~

:::

### 3. Source or install the completion script

::: code-group

~~~~ bash [Bash]
# Bash: Source the script in your shell configuration
echo "source ~/.bashrc.d/myapp.bash" >> ~/.bashrc
~~~~

~~~~ zsh [zsh]
# zsh: Ensure completion directory is in fpath
# (usually automatic with oh-my-zsh)
~~~~

~~~~ fish [fish]
# fish: Completions are automatically loaded from ~/.config/fish/completions/
# No additional configuration needed - just restart fish or run:
fish_update_completions
~~~~

~~~~ powershell [PowerShell]
# PowerShell: Add to your profile
Add-Content $PROFILE ". $PWD/myapp-completion.ps1"
# Or load in current session
. ./myapp-completion.ps1
~~~~

~~~~ nushell [Nushell]
# Nushell: Source the completion script in your config
# The script automatically registers the completer when loaded
source myapp-completion.nu

# Or add to your config file to load on startup:
# echo "source ~/myapp-completion.nu" | save --append $nu.config-path
~~~~

:::

### 4. Test completion

~~~~ bash
# Test that completion is working
myapp <TAB>
myapp --format <TAB>
myapp --format=<TAB>
~~~~

### Distribution considerations

For published CLI tools, consider:

 -  Including completion installation instructions in your *README*
 -  Providing install scripts that automatically set up completion
 -  Supporting common completion directories (*/etc/bash\_completion.d/*,
    */usr/share/zsh/site-functions/*)
 -  Documenting completion setup in your help text

Completion significantly improves CLI usability and is expected by users of
modern command-line tools. Optique's built-in support makes adding completion
straightforward while maintaining type safety and consistency with your
parser definitions.

<!-- cSpell: ignore myapp fpath -->
