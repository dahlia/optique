---
description: Maintain a tested Agent Skill for using an application built with Optique.
---

Skills for using your CLI
=========================

Optique's shipped Agent Skill teaches agents to build a CLI with the library.
An agent using your installed application needs a different bundle: which task
fits which command, what input to supply, and what executing it changes.
Those workflow effects need evidence from your application.

The [skill-notes specimen] pairs an independently runnable example with a
copyable *SKILL.md*, local references, two hand-written workflows and tests.
It uses existing parsing and subprocess helpers; no generator or extra global
CLI flag is needed. The bundle works offline when copied with its references.

[skill-notes specimen]: https://github.com/dahlia/optique/tree/main/examples/skill-pilot


Adapt the specimen
------------------

Start with two useful tasks and a small command surface. Give the bundle an
application-specific name and description using the [Agent Skills format].
Match its directory to the name, use portable lowercase ASCII letters/digits
and single internal hyphens, and keep metadata values as strings. Record the
tested CLI version in metadata and the body, with an executable version check.

Keep installation prerequisites and exact invocation in the bundle. State the
covered commands and any omissions, including runner-provided help, version
and completion inputs. A bundle for an unpublished fixture must explain its
local archive installation rather than suggest a registry package exists.
Copy the entire directory, including all linked references; links should resolve
from the skill root and stay within the copy. This Agent Skills convention also
applies to links written inside its reference files, even when a generic
Markdown viewer would resolve them relative to that file.

Write each workflow's guidance by hand. Identify inputs, output destinations,
file/service changes, credentials and interaction. Command verbs do not
establish read/write effects: a command named `show` may still write a cache.
Mark unknown or untested effects explicitly. The skill informs the agent's
execution decision; it does not authorize reading or writing files or calling a
service.

Use `parseArgs()` from *@optique/testing/parser* for maintained argument
examples. Use `createCliRunner()` from *@optique/testing/cli* for actual
workflows, with explicit stdin and environment overrides in a fresh test-owned
working directory. Compare stdout, stderr and status to the bundled examples.
Also compare relevant files before and after: captured process output does not
establish side effects. The specimen snapshots its whole temporary working
directory; that does not cover effects elsewhere or prove isolation from the
inherited environment.

Validate the copied bundle's name, description, directory, string metadata,
local links and version agreement with the executable. Keep displayed argument,
output and exit examples tied to executable checks. A changed covered option or
workflow must fail those checks, rather than silently leave a stale skill.
The specimen includes controls for a renamed option, incorrect documented
output, version mismatch and broken links.

Run one observable agent pilot with the copied bundle and installed application.
Give it task-oriented prompts rather than exact commands. Record the agent name
and version, the actual model, prompts, attempted commands, outcomes and
failures. Have a maintainer observe the session and distinguish that
observation from an automated dry run. One successful session establishes that
session's behavior, not universal success. See the specimen's [pilot record]
for its measured boundary.

[Agent Skills format]: https://agentskills.io/specification
[pilot record]: https://github.com/dahlia/optique/blob/main/examples/skill-pilot/PILOT.md


Keep the bundle current
-----------------------

When command definitions change, revise the skill and its examples in the same
change. Rerun parser, workflow and installed-package checks, then review effect
descriptions against the new behavior before releasing. A changed error message
can require updating a recovery example even when argument syntax stays valid.
The skill-notes README gives commands for the three-runtime tests and local
package smoke check.

Syntax, canonical command paths, defaults and version checks are possible future
generation inputs. Credentials, workflow intent, permission boundaries and
effects still need author review. The pilot report identifies duplicated
maintenance without claiming that this issue introduces a general command
metadata protocol. A future Markdown reference renderer could supply explicitly
constructed `DocPage` entries with author-declared coverage, including whether
runner meta inputs are present. It would not establish callback-free traversal
of arbitrary parsers.
