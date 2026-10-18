A consumer skill pilot
======================

This private example pairs a small Optique application with a copyable
[consumer skill bundle]. The bundle teaches an agent to *use skill-notes*.
Optique's shipped [library-authoring skill] instead teaches agents to build
CLIs. Neither installs itself into an agent directory.

The fixture deliberately has only `count INPUT` and `save INPUT --output FILE`.
It is independent of the separate file-inspection example proposal. A later
adaptation can reuse that example's installation recipe without making this
pilot depend on an unmerged branch.

[consumer skill bundle]: skills/skill-notes/SKILL.md
[library-authoring skill]: ../../packages/core/skills/optique/SKILL.md


Run and test
------------

From the checkout root, use the mise-managed tools and dependencies:

~~~~ bash
mise deps
mise skill-pilot:build
node examples/skill-pilot/src/cli.ts --version
node examples/skill-pilot/src/cli.ts count README.md
mise exec -- deno test --allow-read --allow-write --allow-run --allow-env examples/skill-pilot/src/pilot.test.ts
mise exec -- pnpm --dir examples/skill-pilot test
mise exec -- pnpm --dir examples/skill-pilot test:bun
~~~~

Node source execution requires Node.js 24.15+; the recorded pilot reports the
actual runtime. Deno/Bun source checks use the current runtime through
`createCliRunner()`. The root `mise test` includes this workspace's tests on
all three runtimes. The package is private and is not published to a registry.

`count` prints JSON such as `{"lines":2}`. `save` copies bytes into a new
exclusive-create file and prints its byte count. Only INPUT `-` reads stdin.
There are no configuration sources, credentials, prompts or network clients.
See the bundle for exact output, errors, permissions and untested effects.


Pack, install and prepare an observation
----------------------------------------

On Linux with `tar` available:

~~~~ bash
mise skill-pilot:smoke
~~~~

This task first rebuilds workspace dependencies and the Node-targeted bundle,
packs the current fixture, checks the packed manifest for runtime dependency
edges, then installs it in a separate consumer project. Installation is offline
with an initially empty pnpm store. It invokes the installed bin shim outside
the checkout against every maintained example, including both tasks and the
invalid-input/recovery example. It copies the installed skill directory and
checks it against the source bundle. No workspace links supply the installed
command's runtime dependencies.

The task retains an isolated directory under the system temporary directory and
prints its path. *tmp/skill-pilot/latest.json* in the checkout records that
path, exact bin, copied bundle, task directory, archive/CLI/skill hashes, source
revision and dirty flag, tool versions, results and two task prompts. These are
local artifacts, not files to commit. The archive hash identifies the artifact
used; it is not a promise that two packs have identical archive bytes.

Observe one fresh agent session in the printed task directory. Put the printed
bin directory on PATH and supply the copied *skill-notes/SKILL.md* plus its
reference files. Give both task prompts from the receipt, let the agent choose
commands, and retain its attempted commands, errors, outcomes, agent version
and actual model. Check the resulting *saved.txt* against *notes.txt*. Tell the
agent to use the bundle and installed command, without inspecting application
source. Such an instruction is an access boundary by convention, not a sandbox.
A maintainer must actually observe the session before recording that acceptance
criterion as complete. The [pilot report] distinguishes that observation from
an automated dry run.

The [adaptation recipe] explains the update
procedure and which facts require authored workflow guidance.

[pilot report]: PILOT.md
[adaptation recipe]: ../../docs/consumer-skills.md
