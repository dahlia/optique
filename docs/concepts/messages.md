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
