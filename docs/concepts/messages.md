---
description: >-
  Structured messages provide a type-safe way to create rich error messages
  and help text using template literals with semantic components for options,
  values, and metavariables.
---

Structured messages
===================

Optique provides a structured message system for creating rich, well-formatted
error messages and help text. Instead of plain strings, messages are composed of
typed components that ensure consistent presentation and help users distinguish
between different types of CLI elements like option names, user values, and
metavariables.

The message system separates content from presentation—you focus on what the
message should communicate, while Optique handles the formatting details.
This approach ensures that all error messages and help text follow consistent
conventions across your CLI application, making them easier for users to
understand and for you to maintain.


Template literal syntax
-----------------------

The primary way to create messages is through the `message` template literal
function, which allows natural embedding of different content types:

~~~~ typescript twoslash
const minPort: string = "";
const maxPort: string = ""
const actualPort: string = "";
// ---cut-before---
import { message, optionName } from "@optique/core/message";

// Simple text message
const greeting = message`Welcome to the application!`;

// Message with embedded values
const error =
  message`Expected port between ${minPort} and ${maxPort}, got ${actualPort}.`;

// Message with CLI-specific elements
const optionError = message`Option ${optionName("--port")} requires a valid number.`;
~~~~

Message components
------------------

Messages can contain several types of components, each with specific semantic
meaning and visual styling:

### Plain text

Regular message content that provides context and explanation.
Plain text appears as normal text without any special formatting.

### Values

User-provided input that should be clearly distinguished from other text.
Values are automatically styled with highlighting and quotes to make them stand out:

~~~~ typescript twoslash
import { message } from "@optique/core/message";
// ---cut-before---
const userInput = "invalid-port";
const errorMsg = message`Invalid port ${userInput}.`;
~~~~

With colors (no quotes):

~~~~ ansi
Invalid port [32minvalid-port[0m.
~~~~

Without colors (with quotes):

~~~~ ansi
Invalid port "invalid-port".
~~~~

### Option names

CLI option references like `--verbose` or `-p` that should be consistently
styled. Option names are displayed in italics with backticks:

~~~~ typescript twoslash
import { message, optionName } from "@optique/core/message";
// ---cut-before---
const helpMsg = message`Use ${optionName("--verbose")} for detailed output.`;
~~~~

With colors (no quotes):

~~~~ ansi
Use [3m--verbose[0m for detailed output.
~~~~

Without colors (with quotes):

~~~~ ansi
Use `--verbose` for detailed output.
~~~~

For multiple option alternatives, use `optionNames` to display them with proper
separation:

~~~~ typescript twoslash
import { message, optionNames } from "@optique/core/message";
// ---cut-before---
const helpMsg = message`Use ${optionNames(["--help", "-h", "-?"])} for usage information.`;
~~~~

With colors (no quotes):

~~~~ ansi
Use [3m--help[0m/[3m-h[0m/[3m-?[0m for usage information.
~~~~

Without colors (with quotes):

~~~~ ansi
Use `--help`/`-h`/`-?` for usage information.
~~~~

### Metavariables

Placeholder names like `FILE` or `PORT` used in help text and error messages.
Metavariables are displayed in bold to indicate they represent user input:

~~~~ typescript twoslash
import { message, metavar } from "@optique/core/message";
// ---cut-before---
const errorMsg = message`Expected ${metavar("NUMBER")}, got invalid input.`;
~~~~

With colors (no quotes):

~~~~ ansi
Expected [1mNUMBER[0m, got invalid input.
~~~~

Without colors (with quotes):

~~~~ ansi
Expected `NUMBER`, got invalid input.
~~~~

### Environment variables

*Available since Optique 0.5.0.*

Environment variable names that should be highlighted distinctly from other
components. Environment variables are displayed in bold with underlines:

~~~~ typescript twoslash
import { message, envVar } from "@optique/core/message";
// ---cut-before---
const configMsg = message`Set ${envVar("API_URL")} environment variable.`;
~~~~

With colors (no quotes):

~~~~ ansi
Set [1;4mAPI_URL[0m environment variable.
~~~~

Without colors (with quotes):

~~~~ ansi
Set `API_URL` environment variable.
~~~~

### Command-line examples

*Available since Optique 0.6.0.*

Command-line snippets and examples that should be visually distinct from
other message components. Command-line examples are displayed in cyan color
to clearly indicate executable commands:

~~~~ typescript twoslash
import { message, commandLine } from "@optique/core/message";
// ---cut-before---
const helpMsg = message`Run ${commandLine("myapp --help")} to see all options.`;
~~~~

With colors (no quotes):

~~~~ ansi
Run [36mmyapp --help[0m to see all options.
~~~~

Without colors (with quotes):

~~~~ ansi
Run `myapp --help` to see all options.
~~~~

This is particularly useful for showing command examples in help text and
footer sections:

~~~~ typescript twoslash
import { message, commandLine } from "@optique/core/message";
// ---cut-before---
const examples = message`Examples:
  ${commandLine("myapp completion bash > myapp-completion.bash")}
  ${commandLine("myapp completion zsh  > _myapp")}
  ${commandLine("myapp --config app.json --verbose")}`;
~~~~

### Consecutive values

Consecutive values that were provided together, such as multiple arguments or
repeated option values. These are displayed as a sequence with consistent
formatting:

~~~~ typescript twoslash
import { message, values } from "@optique/core/message";
// ---cut-before---
const invalidArgs = ["file1.txt", "file2.txt", "file3.txt"];
const errorMsg = message`Invalid files: ${values(invalidArgs)}.`;
~~~~


With colors (no quotes):

~~~~ ansi
Invalid files: [32mfile1.txt file2.txt file3.txt[0m.
~~~~

Without colors (with quotes):

~~~~ ansi
Invalid files: "file1.txt" "file2.txt" "file3.txt".
~~~~

### Value sets

*Available since Optique 0.9.0.*

Value sets are used for displaying a list of valid choices (such as in error
messages for `choice()` value parsers) with proper locale-aware formatting.
Unlike `values()` which is for consecutive user-provided values separated by
spaces, `valueSet()` uses `Intl.ListFormat` to format lists according to locale
conventions with appropriate conjunctions like “and” or “or”.

~~~~ typescript twoslash
import { message, valueSet } from "@optique/core/message";
// ---cut-before---
const choices = ["error", "warn", "info", "debug"];
const input = "invalid";

// Format as conjunction: "error", "warn", "info" and "debug"
const errorMsg = message`Invalid log level: ${input}. Valid levels: ${valueSet(choices)}.`;

// Format as disjunction: "error", "warn", "info" or "debug"
const altMsg = message`Expected ${valueSet(choices, { type: "disjunction" })}.`;
~~~~

Each choice appears with proper formatting:

With colors:

~~~~ ansi
Invalid log level: [32minvalid[0m. Valid levels: [32merror[0m, [32mwarn[0m, [32minfo[0m and [32mdebug[0m.
~~~~

Without colors:

~~~~ ansi
Invalid log level: "invalid". Valid levels: "error", "warn", "info" and "debug".
~~~~

You can also specify a locale for proper internationalization:

~~~~ typescript twoslash
import { message, valueSet } from "@optique/core/message";
// ---cut-before---
const choices = ["error", "warn", "info"];

// Korean disjunction: "error", "warn" 또는 "info"
const koreanMsg = message`${valueSet(choices, { locale: "ko", type: "disjunction" })} 중 하나여야 합니다.`;

// Japanese conjunction: "error"、"warn"、"info"
const japaneseMsg = message`${valueSet(choices, { locale: "ja" })}のいずれかを指定してください。`;
~~~~

The `valueSet()` function accepts the following options:

`locale`
:   The locale(s) to use for formatting. Can be a string, array of strings,
    `Intl.Locale` object, or array of `Intl.Locale` objects. Defaults to the
    system locale.

`type`
:   The type of list: `"conjunction"` for “and” lists (default),
    `"disjunction"` for “or” lists, or `"unit"` for simple comma-separated
    lists.

`style`
:   The formatting style: `"long"` (default), `"short"`, or `"narrow"`.

> [!NOTE]
> Do not use `.join(", ")` for choice lists, as this concatenates all choices
> into a single value string, losing individual formatting:
> `"error, warn, info, debug"` instead of `"error", "warn", "info", "debug"`.

> [!NOTE]
> Since `valueSet()` relies on the runtime's `Intl.ListFormat` implementation,
> the exact formatting may vary slightly between JavaScript runtimes. For
> example, Bun uses the Oxford comma (`"a", "b", and "c"`) while Deno and
> Node.js do not (`"a", "b" and "c"`).

### Combined examples

~~~~ typescript twoslash
const userInput: string = "";
const userValue: string = "";
// ---cut-before---
import {
  commandLine,
  envVar,
  message,
  metavar,
  optionName,
  optionNames,
  values,
} from "@optique/core/message";

const examples = {
  // Automatic value embedding
  simpleValue: message`Invalid value ${userInput}.`,

  // Single option name highlighting
  optionRef: message`Unknown option ${optionName("--invalid")}.`,

  // Multiple option alternatives
  helpOptions: message`Try ${optionNames(["--help", "-h"])} for usage.`,

  // Metavariable for documentation
  usage: message`Expected ${metavar("FILE")} argument.`,

  // Environment variable reference
  envError: message`Environment variable ${envVar("DATABASE_URL")} is not set.`,

  // Command-line example
  cmdExample: message`Run ${commandLine("myapp --config app.json")} to start.`,

  // Consecutive values
  invalidFiles: message`Cannot process files ${values(["missing.txt", "readonly.txt"])}.`,

  // Combined components
  complex: message`Option ${optionName("--port")} expects ${metavar("NUMBER")}, got ${userValue}.`
};
~~~~

Here's how these examples appear in the terminal:

![Terminal output showing seven different message component examples, each
displayed in both colored (no quotes) and non-colored (with quotes) formats,
demonstrating values, option names, metavariables, environment variables, and
complex combinations](messages/combined-examples.png)


Value interpolation
-------------------

When you embed string values directly in a message template, they are
automatically treated as user values:

~~~~ typescript twoslash
import { message } from "@optique/core/message";
// ---cut-before---
const userInput: string = "invalid-port";

// Direct value interpolation - automatically quoted and styled
const error = message`Invalid port ${userInput}.`;
~~~~

Explicit component creation
---------------------------

For dynamic message construction or when you need precise control:

~~~~ typescript twoslash
const isLongForm: boolean = true;
const args: readonly string[] = [];
// ---cut-before---
import {
  message,
  optionName,
  optionNames,
  metavar,
  values
} from "@optique/core/message";

// Dynamic option reference
const option = isLongForm ? "--verbose" : "-v";
const helpMessage = message`Use ${optionName(option)} for detailed output.`;

// Multiple option alternatives
const optionsMessage = message`Try ${optionNames(["--help", "-h", "-?"])} for usage.`;

// Consecutive values
const valuesMessage = message`Invalid values: ${values(args)}.`;

// Metavariable in error context
const typeError = message`Expected ${metavar("STRING")}, got ${metavar("NUMBER")}.`;
~~~~

Message composition
-------------------

You can compose complex messages by embedding existing `Message` objects within
new message templates. When a `Message` object is interpolated, its components
are automatically concatenated:

~~~~ typescript twoslash
import { message, optionName, metavar } from "@optique/core/message";

// Create reusable message components
const invalidInput = message`invalid input format.`;
const missingOption = message`required option ${optionName("--config")} not found.`;

// Compose messages by embedding existing ones
const contextualError = message`Configuration error: ${invalidInput}`;
const detailedError = message`Setup failed - ${missingOption}`;

// Complex composition with multiple message parts
const troubleshootingInfo = message`Check ${metavar("FILE")} permissions.`;
const fullError = message`${detailedError} ${troubleshootingInfo}`;
~~~~

This composition feature enables building structured error messages from
reusable components:

~~~~ typescript twoslash
import { message, optionName } from "@optique/core/message";

// Base error messages
const errorMessages = {
  fileNotFound: (filename: string) => message`File ${filename} not found.`,
  permissionDenied: (action: string) => message`Permission denied for ${action}.`,
  invalidFormat: (format: string) => message`Invalid ${format} format.`
};

// Compose complex errors from base messages
function createFileError(filename: string, action: string) {
  const baseError = errorMessages.fileNotFound(filename);
  const permissionError = errorMessages.permissionDenied(action);

  return message`Operation failed: ${baseError} ${permissionError}`;
}

// Usage in parser error handling
const configError = createFileError("config.json", "read");
const validationError = message`${errorMessages.invalidFormat("JSON")} in configuration.`;
~~~~


Line break handling
-------------------

*Available since Optique 0.7.0.*

The `formatMessage()` function handles line breaks in a way similar to Markdown,
distinguishing between soft breaks (word wrap points) and hard breaks (actual
paragraph separations):

### Single newlines (`\n`)

Single newlines in `text()` terms are treated as soft breaks and converted to
spaces. This allows you to write long messages across multiple lines in source
code while rendering them as continuous text:

~~~~ typescript twoslash
import { message, text } from "@optique/core/message";

// Long message written across multiple lines
const msg = message`This is a very long error message that\nspans multiple lines in the source code\nbut renders as continuous text.`;
~~~~

This renders as:

~~~~
This is a very long error message that spans multiple lines in the source code but renders as continuous text.
~~~~

### Double newlines (`\n\n`)

Double or more consecutive newlines are treated as hard breaks, creating actual
paragraph separations in the output:

~~~~ typescript twoslash
import { message, text } from "@optique/core/message";

// Message with paragraph break
const msg = [
  text("First paragraph with important information."),
  text("\n\n"),
  text("Second paragraph with additional details.")
];
~~~~

This renders as:

~~~~
First paragraph with important information.
Second paragraph with additional details.
~~~~

This distinction is particularly useful for multi-part error messages, such as
those with suggestions or help text, ensuring proper spacing between the base
error and additional information.


Terminal output
---------------

Once you've created structured messages, you can output them to the terminal
using the print functions provided by `@optique/run/print`.

The `print()` function displays messages to stdout with automatic formatting:

~~~~ typescript twoslash
import { print } from "@optique/run";
import { message, optionName } from "@optique/core/message";

const configFile = "app.config.json";
const port = 3000;

// Simple informational output
print(message`Starting application...`);

// Output with embedded values
print(message`Configuration loaded from ${configFile}.`);
print(message`Server listening on port ${String(port)}.`);

// Output with CLI elements
print(message`Use ${optionName("--verbose")} for detailed logging.`);
~~~~

By default, `print()` automatically detects whether your terminal supports
colors and adjusts the formatting accordingly. Values are highlighted,
option names are styled consistently, and the output width adapts to your
terminal size.


Error handling
--------------

The `printError()` function is specifically designed for error messages,
outputting to stderr with an `Error: ` prefix:

~~~~ typescript twoslash
import { printError } from "@optique/run";
import { message, optionName } from "@optique/core/message";

const filename = "missing.txt";
const invalidValue = "not-a-number";

// Simple error message
printError(message`File ${filename} not found.`);

// Error with CLI context
printError(message`Invalid value ${invalidValue} for ${optionName("--port")}.`);

// Critical error that exits the process
printError(message`Cannot connect to database.`, { exitCode: 1 });
~~~~

When you provide an `exitCode`, the function will terminate the process after
displaying the error. This is useful for fatal errors that should stop
execution immediately.


Custom printers
---------------

For specialized output needs, you can create custom printers with predefined
formatting options:

~~~~ typescript twoslash
import { createPrinter } from "@optique/run";
import { message, metavar, optionName } from "@optique/core/message";

// Create a printer for debugging output
const debugPrint = createPrinter({
  stream: "stderr",
  colors: true,    // Force colors even in non-TTY
  quotes: false,   // Disable quote marks around values
});

// Create a printer for plain text logs
const logPrint = createPrinter({
  colors: false,   // Disable all colors
  quotes: true,    // Ensure values are clearly marked
  maxWidth: 80,    // Wrap long lines at 80 characters
});

// Use custom printers
debugPrint(message`Debugging ${metavar("MODULE")} initialization.`);
logPrint(message`Processing file ${metavar("FILENAME")}.`);
~~~~


Output customization
--------------------

All output functions accept formatting options to override automatic detection:

~~~~ typescript twoslash
import { print, printError } from "@optique/run";
import { message, optionName } from "@optique/core/message";

// Force specific formatting
print(message`Status: ${optionName("--quiet")} mode enabled.`, {
  colors: false,    // Disable colors
  quotes: true,     // Force quote marks
  maxWidth: 60,     // Wrap at 60 characters
});

// Output to different stream
print(message`Debug information.`, { stream: "stderr" });

// Error without automatic exit
printError(message`Warning: deprecated ${optionName("--old-flag")}.`);
~~~~

The formatting options give you fine-grained control while maintaining
the structured nature of your messages across different output contexts.


Customizing parser error messages
---------------------------------

*Available since Optique 0.5.0.*

Optique allows you to customize error messages for all parser types through
their `errors` option. This provides better user experience by giving
context-specific feedback instead of generic error messages.

### Basic parser errors

Most primitive parsers support customizing their core error conditions:

~~~~ typescript twoslash
import { option, flag } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";
import { message, optionName, metavar, type Message } from "@optique/core/message";

// Option parser with custom errors
const portOption = option("--port", integer(), {
  errors: {
    missing: message`${optionName("--port")} is required for server startup.`,
    invalidValue: (error: Message) => message`Port validation failed: ${error}`,
    endOfInput: message`${optionName("--port")} requires a ${metavar("NUMBER")}.`
  }
});

// Flag parser with custom error
const verboseFlag = flag("--verbose", {
  errors: {
    duplicate: (token: string) =>
      message`${optionName("--verbose")} was already specified: ${token}.`
  }
});
~~~~

### Function-based error messages

Error messages can be functions that receive the problematic input and return
a customized message. This allows for more specific and helpful feedback:

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { message, optionName, type Message } from "@optique/core/message";

const formatOption = option("--format", string(), {
  errors: {
    // Static message
    missing: message`Output format must be specified.`,

    // Dynamic message based on original error
    invalidValue: (error: Message) => {
      return message`Invalid format specified: ${error}`;
    }
  }
});
~~~~

### Combinator error customization

Parser combinators like `or()` and `longestMatch()` also support error
customization for better failure reporting:

~~~~ typescript twoslash
import { or } from "@optique/core/constructs";
import { constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { message, optionName } from "@optique/core/message";

// Custom error when no alternative matches
const configOption = option("--config", string());
const helpOption = option("--help");
const configOrHelp = or(configOption, helpOption, {
  errors: {
    noMatch: message`Either provide ${optionName("--config")} or use help option.`,
    unexpectedInput: (token: string) =>
      message`Unexpected input ${token}. Expected configuration or help option.`
  }
});
~~~~

### Object parser error customization

Object parsers can customize errors for missing required fields and
unexpected properties:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";
import { message, optionName } from "@optique/core/message";

const serverConfig = object({
  host: option("--host", string()),
  port: option("--port", integer())
}, {
  errors: {
    unexpectedInput: (token: string) =>
      message`Unknown server option ${optionName(token)}.`,
    endOfInput: message`Server configuration incomplete. Expected more options.`
  }
});
~~~~

### Multiple parser error customization

Multiple parsers can provide custom messages for count validation:

~~~~ typescript twoslash
import { multiple } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { message, optionName, metavar } from "@optique/core/message";

const inputFiles = multiple(option("--input", string()), {
  min: 1,
  max: 5,
  errors: {
    tooFew: (count: number, min: number) =>
      message`At least ${String(min)} input file(s) required, got ${String(count)}.`,
    tooMany: (count: number, max: number) =>
      message`Maximum ${String(max)} input files allowed, got ${String(count)}.`
  }
});
~~~~

### Value parser error customization

Value parsers can also provide custom error messages for validation failures.
This allows you to give more specific feedback when user input doesn't meet
the expected format or constraints.

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { string, integer, choice, url } from "@optique/core/valueparser";
import { message, optionName, values, text } from "@optique/core/message";

// String parser with pattern validation
const codeOption = option("--code", string({
  pattern: /^[A-Z]{3}-\d{4}$/,
  errors: {
    patternMismatch: (input, pattern) =>
      message`Code ${input} must follow format ABC-1234.`
  }
}));

// Integer parser with range validation
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

// Choice parser with custom suggestions
const formatOption = option("--format", choice(["json", "yaml", "xml"], {
  errors: {
    invalidChoice: (input, choices) =>
      message`Format ${input} not supported. Available: ${values(choices)}.`
  }
}));

// URL parser with protocol restrictions
const endpointOption = option("--endpoint", url({
  allowedProtocols: ["https:"],
  errors: {
    invalidUrl: message`Please provide a valid web address.`,
    disallowedProtocol: (protocol, allowedProtocols) =>
      message`Only secure connections allowed. Use ${values(allowedProtocols)} instead of ${protocol}.`
  }
}));
~~~~

Value parser error customization works with all built-in parsers:

`string()`
:   Custom `patternMismatch` errors for regex validation

`integer()` and `float()`
:   Custom `invalidInteger`/`invalidNumber`, `belowMinimum`, and `aboveMaximum`
    errors

`choice()`
:   Custom `invalidChoice` errors with available options

`url()`
:   Custom `invalidUrl` and `disallowedProtocol` errors

`locale()`
:   Custom `invalidLocale` errors for malformed locale identifiers

`uuid()`
:   Custom `invalidUuid` and `disallowedVersion` errors

### Additional packages

The error customization system also extends to additional Optique packages:

#### `@optique/run` package

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { path } from "@optique/run/valueparser";
import { message, text, values } from "@optique/core/message";

// File path parser with custom validation errors
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

// Output directory with creation support
const outputDir = option("--output", path({
  type: "directory",
  allowCreate: true,
  errors: {
    parentNotFound: (parentDir) =>
      message`Cannot create output directory: parent ${parentDir} doesn't exist.`,
    notADirectory: (input) =>
      message`Output path ${input} exists but is not a directory.`,
  }
}));
~~~~

#### `@optique/temporal` package

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
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

### Best practices for custom errors

When customizing error messages, follow these patterns for consistent and
helpful user experience:

 1. *Be specific*: Include the problematic input value when possible
 2. *Provide context*: Reference the specific option or command involved
 3. *Suggest solutions*: Mention valid alternatives or corrective actions
 4. *Use consistent styling*: Apply proper component types for CLI elements

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { message, optionName, metavar, values, type Message } from "@optique/core/message";

// Good: Specific, contextual, actionable
const databaseUrl = option("--database", string(), {
  errors: {
    missing: message`Database connection required. Set ${optionName("--database")} or DATABASE_URL environment variable.`,
    invalidValue: (error: Message) => {
      return message`Database URL validation failed: ${error}`;
    }
  }
});

// Good: Lists valid alternatives with custom validation
const logLevel = option("--log-level", string(), {
  errors: {
    invalidValue: (error: Message) => {
      const validLevels = ["debug", "info", "warn", "error"];
      return message`Log level validation failed: ${error}. Valid levels: ${values(validLevels)}.`;
    }
  }
});
~~~~

Custom error messages integrate seamlessly with Optique's structured message
system, ensuring consistent formatting and proper terminal output regardless
of whether colors are enabled or disabled.


### Suggestion message customization

*Available since Optique 0.7.0.*

Optique's automatic "Did you mean?" suggestions can also be customized through
the `errors` option. This allows you to control how suggestion messages are
formatted or disable them entirely for specific parsers.

#### Option and flag parsers

The `option()` and `flag()` parsers support a `noMatch` error option that
receives both the invalid input and an array of similar valid options:

~~~~ typescript twoslash
import { option, flag } from "@optique/core/primitives";
import { integer } from "@optique/core/valueparser";
import { message, values } from "@optique/core/message";

// Custom suggestion format
const portOption = option("--port", integer(), {
  errors: {
    noMatch: (invalidOption, suggestions) =>
      suggestions.length > 0
        ? message`Unknown option ${invalidOption}. Try: ${values(suggestions)}`
        : message`Unknown option ${invalidOption}.`
  }
});

// Disable suggestions by ignoring the suggestions parameter
const quietOption = option("--quiet", {
  errors: {
    noMatch: (invalidOption, _suggestions) =>
      message`Invalid option: ${invalidOption}`
  }
});

// Use static message (no suggestions)
const verboseFlag = flag("--verbose", {
  errors: {
    noMatch: message`Please use a valid flag.`
  }
});
~~~~

#### Command parser

The `command()` parser's `notMatched` error option now receives suggestions
as an optional third parameter:

~~~~ typescript twoslash
import { command } from "@optique/core/primitives";
import { object } from "@optique/core/constructs";
import { message, values } from "@optique/core/message";

const addCmd = command("add", object({}), {
  errors: {
    notMatched: (expected, actual, suggestions) => {
      if (actual == null) {
        return message`Expected ${expected} command.`;
      }
      if (suggestions && suggestions.length > 0) {
        return message`Unknown command ${actual}. Similar commands: ${values(suggestions)}`;
      }
      return message`Unknown command ${actual}.`;
    }
  }
});
~~~~

#### Combinator and object parsers

The `or()`, `longestMatch()`, and `object()` parsers support a `suggestions`
error option that customizes how suggestions are formatted. This function
receives the array of suggestions and returns a message to append to the
error:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";
import { message, values, text } from "@optique/core/message";

// Custom suggestion formatting
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

// Disable suggestions entirely
const strictConfig = object({
  host: option("--host", string()),
  port: option("--port", integer())
}, {
  errors: {
    suggestions: () => [] // Return empty message to disable suggestions
  }
});
~~~~

The `suggestions` formatter is called with an array of similar valid
option/command names found through Levenshtein distance matching. You can:

 -  Format suggestions differently (e.g., comma-separated instead of list)
 -  Add additional context or help text
 -  Filter or reorder suggestions
 -  Return an empty array to disable suggestions

~~~~ typescript twoslash
import { or } from "@optique/core/constructs";
import { command } from "@optique/core/primitives";
import { object } from "@optique/core/constructs";
import { message, optionName, text, type Message } from "@optique/core/message";

const addCmd = command("add", object({}));
const commitCmd = command("commit", object({}));

const parser = or(
  addCmd,
  commitCmd,
  {
    errors: {
      suggestions: (suggestions) => {
        if (suggestions.length === 0) return [];
        if (suggestions.length === 1) {
          return message`Did you mean ${optionName(suggestions[0])}?
            Run with ${optionName("--help")} for usage.`;
        }
        // Format as comma-separated list
        let parts: Message = [text("Did you mean: ")];
        for (let i = 0; i < suggestions.length; i++) {
          parts = i > 0
            ? [...parts, text(", "), optionName(suggestions[i])]
            : [...parts, optionName(suggestions[i])];
        }
        return [...parts, text("?")];
      }
    }
  }
);
~~~~

Note that if you provide a custom `unexpectedInput` error, suggestions will
not be added automatically. You must use the `suggestions` formatter if you
want suggestions with a custom `unexpectedInput` message.


Automatic “Did you mean?” suggestions
-------------------------------------

*Available since Optique 0.7.0.*

Optique automatically provides helpful “Did you mean?” suggestions when users
make typos in option names or command names. This feature works transparently
without requiring any configuration—when a user enters an invalid option or
command that's similar to a valid one, Optique suggests the correct alternative:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { run } from "@optique/run";

const parser = object({
  verbose: option("--verbose"),
  version: option("--version"),
  verify: option("--verify"),
});

run(parser, { args: ["--verbos"] });  // User typo
~~~~

This produces the error:

~~~~
Error: No matched option for `--verbos`.
Did you mean `--verbose`?
~~~~

### How it works

The suggestion system uses [Levenshtein distance] to find similar
names among available options and commands. It automatically:

 -  Compares the invalid input against all valid option and command names
 -  Finds matches within an edit distance of 3 characters
 -  Filters candidates by distance ratio (at most 50% of input length)
 -  Suggests up to 3 closest matches
 -  Uses case-insensitive comparison for better user experience

[Levenshtein distance]: https://en.wikipedia.org/wiki/Levenshtein_distance

### Multiple suggestions

When multiple similar options exist, Optique shows all relevant suggestions:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { run } from "@optique/run";

const parser = object({
  verbose: option("--verbose"),
  version: option("--version"),
  verify: option("--verify"),
});

run(parser, { args: ["--ver"] });  // Ambiguous typo
~~~~

This produces:

~~~~
Error: No matched option for `--ver`.
Did you mean one of these?
  `--verify`
  `--version`
  `--verbose`
~~~~

### Command name suggestions

The feature works equally well with subcommand names:

~~~~ typescript twoslash
import { object, or } from "@optique/core/constructs";
import { command } from "@optique/core/primitives";

const addCmd = command("add", object({}));
const commitCmd = command("commit", object({}));
const parser = or(addCmd, commitCmd);
~~~~

When a user types `comit` instead of `commit`:

~~~~
Error: Expected command commit, but got comit.
Did you mean `commit`?
~~~~

### Suggestion thresholds

Suggestions are only shown when they're likely to be helpful. Optique won't
suggest options that are too different from what the user typed:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { run } from "@optique/run";

const parser = object({
  verbose: option("--verbose"),
  quiet: option("--quiet"),
});

run(parser, { args: ["--xyz"] });  // Too different
~~~~

This produces an error without suggestions:

~~~~
Error: Unexpected option or argument: `--xyz`.
~~~~

The thresholds ensure that suggestions are relevant without overwhelming users
with unrelated options.

### Integration with error messages

Suggestions are automatically appended to error messages with proper formatting,
including appropriate line breaks for readability. They work seamlessly with
both colored and non-colored terminal output, and integrate with custom error
messages you may have defined.
