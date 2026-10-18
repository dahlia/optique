Consumer skill pilot record
===========================

On 2026-10-18, one fresh Claude Code session attempted both tasks using the
copied skill bundle and a locally installed, packed skill-notes fixture outside
the Optique checkout. Both CLI tasks succeeded. This was an automated dry run;
*maintainer observation remains pending*. It does not establish universal agent
success or complete that human-observation acceptance criterion.


Setup and task prompts
----------------------

The host was Linux, Node.js v26.12.0, pnpm 11.28.6, and Claude Code
2.1.302. The pilot model was
`claude-fable-5-1`, confirmed by the completed result's `modelUsage`. Session:
`1fff4df3-b2af-40c5-b7e6-5674f5189d4d`. The CLI and bundle declared version
`1.4.0`; the agent checked the installed executable's version before either
task.

`mise skill-pilot:smoke` rebuilt dependencies, bundled for Node, packed the
private fixture and verified its manifest had no runtime/optional/peer
dependency edges. It installed the archive offline into a separate consumer
project with an initially empty pnpm store, then executed the eight examples in
that artifact through the installed bin shim. The skill directory was copied
from that installation and compared byte-for-byte with its source. Neither the
installed command nor the copied bundle needed the checkout at execution time.

The source base was `c7a6d04d94c5c067e02d0a58857a590533528fd3` with uncommitted
pilot changes. The hashes identify the actual artifacts used, rather than a
later committed revision:

| Artifact                | SHA-256                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| Packed archive          | `4cbb6416b0853902cc76849ff814662293b6ee56927cc7a9d5d5052f01b66033` |
| Installed *dist/cli.js* | `1ad00e43b9116d03fa0ddce07fe0398aafea8dc95a64f457dfcf058e17529f81` |
| Copied *SKILL.md*       | `02a651d1ceac175576ed8aaa61dbdc7cb96ec810ebef20736a3a5530c201cf13` |

The agent started in a separate directory containing only *notes.txt*: `alpha`
LF `beta` LF, 11 bytes. It was directed to read the copied bundle and its local
references, use the installed command, and avoid implementation/source access.
Those limits were instructions, not an OS sandbox. The retained tool events show
bundle/task-file reads and installed-command calls, with no implementation
reads. They do not establish absence of unobserved process access or external
effects.

The same session received these two prompts:

> Using the copied skill bundle, report how many lines notes.txt contains. Do
> not change files for this task.

> Save the contents of notes.txt, supplied through redirected stdin, into a new
> saved.txt. You are authorized to create saved.txt in this task directory, but
> must not overwrite an existing file. Report what was written.


Observed outcomes and failure
-----------------------------

The agent selected the following commands from the bundle, using the absolute
installed-bin path. The commands below use the bare bin name and keep its
arguments and redirection:

~~~~ bash
skill-notes --version
skill-notes count notes.txt
skill-notes save - --output saved.txt < notes.txt
~~~~

The version output was `1.4.0`, then count printed `{"lines":2}`, and save
printed `Saved 11 bytes.`. Each invocation exited with 0. The agent then listed
the task directory, inspected the saved bytes with `od`, and compared the files
with `cmp`. Independent post-run checks confirmed that *notes.txt* was
unchanged, *saved.txt* held the same 11 bytes, and these were the directory's
only files. No CLI invocation failed, so this session did not demonstrate
invalid-input recovery; the three-runtime tests and installed smoke cover that
example.

There was one tool failure. The initial `Read` request for the copied *SKILL.md*
was denied because the CLI permission configuration explicitly allowed Bash but
had not allowed Read. The agent reported it and read all three bundle
files through permitted shell commands before proceeding. The result's
`permission_denials` array retains that denial; this run is not represented as
permission-clean. A prepared observation script explicitly allows Read as well.

The bundle's byte-copy description and version check were useful: the agent
checked the version, chose redirected stdin for the write task, and verified
the saved file. It did not invent a command or use a direct shell write in
place of the fixture. This single session cannot show how other agents handle
stale versions, hidden state or a different task.


Maintenance findings and observation
------------------------------------

Command spellings, version strings and expected outputs appear in both the
application and the bundle. The paired command/output checks and parser tests
make that duplication fail visibly when a covered example drifts. Future tooling
could supply syntax, command paths and version facts; it must not infer workflow
effects, credentials or write authorization from command names.

For an observation, repeat the [README preparation] in a fresh directory, let a
maintainer watch one agent session attempt both task prompts, and record its
outcomes and failures. Keep that observation distinct from this automated run.
The preparation task prints exact copied-bundle, installed-bin and task paths.
The local receipt, raw JSONL tool transcript, readable transcript, CLI version,
model-usage result and session identifier are retained in the task's temporary
workspace; the local completion report supplies their paths.
The transcript includes the denied read and successful shell recovery.

[README preparation]: README.md
