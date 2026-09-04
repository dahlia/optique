---
links:
  '#873': https://github.com/dahlia/optique/issues/873
  '#936': https://github.com/dahlia/optique/issues/936
  '#940': https://github.com/dahlia/optique/pull/940
---
 -  Added shared validation, retry limits, and abort handling to `prompt()`
    for every Clack prompt type, including selection prompts.  Custom
    `prompter` callbacks now receive the attempt number, previous validation
    message, and signal, whose types are re-exported for convenience.
    [[#873], [#936], [#940]]
