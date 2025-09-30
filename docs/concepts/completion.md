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
Optique provides built-in completion support for Bash, zsh, and PowerShell
that integrates seamlessly with the existing parser architecture.

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

~~~~ powershell [PowerShell]
myapp completion pwsh > $PROFILE/../myapp-completion.ps1
Add-Content $PROFILE ". $PROFILE/../myapp-completion.ps1"
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
const parser = {} as unknown as Parser<unknown, unknown>;
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
const parser = {} as unknown as Parser<unknown, unknown>;
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
function customParser(): ValueParser<string> {
  return {
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

### PowerShell completion

PowerShell completion scripts use `Register-ArgumentCompleter` with the
`-Native` parameter to integrate with PowerShell's completion system. The
generated script provides:

 -  AST-based argument extraction for robust parsing
 -  `CompletionResult` objects with descriptions and tooltips
 -  Native file completion using `Get-ChildItem`
 -  Support for hidden files and extension filtering
 -  Cross-platform compatibility (Windows, Linux, macOS)


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
:   Completion via subcommand only (`myapp completion bash`)

`"option"`
:   Completion via option only (`myapp --completion bash`)

`"both"`
:   Both command and option patterns supported

### Automatic handling

When completion is enabled, the `run()` function automatically:

 -  Detects completion requests before normal argument parsing
 -  Generates shell scripts when requested
 -  Provides runtime completion suggestions
 -  Handles output formatting for each shell
 -  Exits with appropriate status codes


Setup instructions
------------------

Follow these steps to add shell completion to your CLI application:

### 1. Enable completion in your application

~~~~ typescript twoslash
import type { Parser } from "@optique/core/parser";
const parser = {} as unknown as Parser<unknown, unknown>;
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

~~~~ powershell [PowerShell]
myapp completion pwsh > myapp-completion.ps1
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

~~~~ powershell [PowerShell]
# PowerShell: Add to your profile
Add-Content $PROFILE ". $PWD/myapp-completion.ps1"
# Or load in current session
. ./myapp-completion.ps1
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
 -  Supporting common completion directories (*/etc/bash_completion.d/*,
    */usr/share/zsh/site-functions/*)
 -  Documenting completion setup in your help text

Completion significantly improves CLI usability and is expected by users of
modern command-line tools. Optique's built-in support makes adding completion
straightforward while maintaining type safety and consistency with your
parser definitions.
