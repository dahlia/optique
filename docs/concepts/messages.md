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

### Multiple values

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

### Combined examples

~~~~ typescript twoslash
const userInput: string = "";
const userValue: string = "";
// ---cut-before---
import {
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

  // Multiple consecutive values
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
import { option, flag } from "@optique/core/parser";
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
import { option } from "@optique/core/parser";
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
import { or, option, constant } from "@optique/core/parser";
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
import { object, option } from "@optique/core/parser";
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
import { multiple, option } from "@optique/core/parser";
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
import { option } from "@optique/core/parser";
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
import { option } from "@optique/core/parser";
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
import { option } from "@optique/core/parser";
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
import { option } from "@optique/core/parser";
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
