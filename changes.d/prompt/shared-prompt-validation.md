---
links:
  '#873': https://github.com/dahlia/optique/issues/873
  '#935': https://github.com/dahlia/optique/issues/935
  '#938': https://github.com/dahlia/optique/pull/938
---
 -  Added shared validation and retry options to prompt adapters.  Generated
    prompt wrappers can validate returned values synchronously or
    asynchronously, pass the preceding validation message to another attempt,
    limit attempts, and abort active prompt or validator work without
    publishing rejected answers.  [[#873], [#935], [#938]]
