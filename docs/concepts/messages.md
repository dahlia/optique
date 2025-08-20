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

Messages can contain several types of components, each with specific semantic meaning:

Plain text
:   Regular message content that provides context and explanation

Values
:   User-provided input that should be clearly distinguished from other text

Option names
:   CLI option references like `--verbose` or `-p` that should be consistently styled

Metavariables
:   Placeholder names like `FILE` or `PORT` used in help text and error messages

~~~~ typescript twoslash
const userInput: string = "";
const userValue: string = "";
// ---cut-before---
import { message, optionName, metavar, values } from "@optique/core/message";

const examples = {
  // Automatic value embedding
  simpleValue: message`Invalid value ${userInput}`,

  // Explicit option name highlighting
  optionRef: message`Unknown option ${optionName("--invalid")}`,

  // Metavariable for documentation
  usage: message`Expected ${metavar("FILE")} argument`,

  // Multiple values
  choices: message`Choose from ${values(["red", "green", "blue"])}`,

  // Combined components
  complex: message`Option ${optionName("--port")} expects ${metavar("NUMBER")}, got ${userValue}`
};
~~~~

Value interpolation
-------------------

When you embed string values directly in a message template, they are
automatically treated as user values:

~~~~ typescript twoslash
import { message } from "@optique/core/message";
// ---cut-before---
const userInput: string = "invalid-port";

// Direct value interpolation - automatically quoted and styled
const error = message`Invalid port ${userInput}`;
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
const helpMessage = message`Use ${optionName(option)} for detailed output`;

// Multiple option alternatives
const optionsMessage = message`Try ${optionNames(["--help", "-h", "-?"])} for usage`;

// Consecutive values
const valuesMessage = message`Invalid values: ${values(args)}`;

// Complex metavariable usage
const usageMessage = message`${metavar("COMMAND")} [${metavar("OPTIONS")}] ${metavar("FILE")}...`;
~~~~

Message composition
-------------------

You can compose complex messages by embedding existing `Message` objects within
new message templates. When a `Message` object is interpolated, its components
are automatically concatenated:

~~~~ typescript twoslash
import { message, optionName, metavar } from "@optique/core/message";

// Create reusable message components
const invalidInput = message`invalid input format`;
const missingOption = message`required option ${optionName("--config")} not found`;

// Compose messages by embedding existing ones
const contextualError = message`Configuration error: ${invalidInput}`;
const detailedError = message`Setup failed - ${missingOption}`;

// Complex composition with multiple message parts
const troubleshootingInfo = message`Check ${metavar("FILE")} permissions`;
const fullError = message`${detailedError}. ${troubleshootingInfo}`;
~~~~

This composition feature enables building structured error messages from
reusable components:

~~~~ typescript twoslash
import { message, optionName } from "@optique/core/message";

// Base error messages
const errorMessages = {
  fileNotFound: (filename: string) => message`File ${filename} not found`,
  permissionDenied: (action: string) => message`Permission denied for ${action}`,
  invalidFormat: (format: string) => message`Invalid ${format} format`
};

// Compose complex errors from base messages
function createFileError(filename: string, action: string) {
  const baseError = errorMessages.fileNotFound(filename);
  const permissionError = errorMessages.permissionDenied(action);

  return message`Operation failed: ${baseError}. ${permissionError}`;
}

// Usage in parser error handling
const configError = createFileError("config.json", "read");
const validationError = message`${errorMessages.invalidFormat("JSON")} in configuration`;
~~~~
