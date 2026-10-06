---
name: release
description: >-
  Create and publish releases for the Optique project. Use when releasing a
  patch, minor, or major version. Handles Sacho release notes, the mise
  bump-version task, tags, and maintenance-branch merges.
metadata:
  internal: true
---

Releasing Optique
=================

Optique releases patch versions from `X.Y-maintenance` branches and major/minor
versions from `main`. Tags have no `v` prefix: use `1.2.7`, not `v1.2.7`.

*changes.d/* holds unreleased entries. With `materialize = true` in
*sacho.toml*, their rendered section in *CHANGES.md* is generated. Edit the
fragments, then synchronize; do not hand-edit the unreleased section or copy
entries into it during merges.


Prepare the branch
------------------

Verify the current branch, working tree, and remotes before changing versions:

~~~~ bash
git status --short --branch
git remote -v
~~~~

The commands below use the `dahlia` remote. Substitute the verified remote name
if this checkout uses another one. Start from an up-to-date branch with no
unrelated changes staged or pending. Choose the target and next versions from
the user's release request and the branch's existing versions.

For a patch release, switch to the matching maintenance branch:

~~~~ bash
git switch 1.2-maintenance
git pull --ff-only dahlia 1.2-maintenance
~~~~

For a major/minor release, use `main` instead. Confirm that *changes.d/next*
and all package versions match the version being released:

~~~~ bash
cat changes.d/next
jq -r .version packages/core/deno.json
mise run check:versions
~~~~

The two printed versions must be equal to each other and to the requested
release version. `check:versions` verifies agreement between package manifests;
it does not compare them with *changes.d/next*.

If the target version needs correction, use `mise run bump-version VERSION`.
This task calls `sacho next`, updates *packages/core/deno.json*, formats it,
and synchronizes all workspace package versions. Use this task instead of
editing package versions manually.

Read the fragments and their compiled output before finalizing the release:

~~~~ bash
sacho sync
sacho fmt
sacho preview
sacho check
mise test
~~~~

If noninteractive `sacho sync` refuses to replace the generated region, inspect
its diff for hand edits. Move any intended text into fragments before running
`sacho sync --force`, then repeat formatting and checking.

Run `pnpm build` in *docs/* before committing documentation changes. Use the
installed `sacho release --help` and `mise run bump-version --help` when
checking command syntax.


Finalize and tag the release
----------------------------

Use `sacho release` to compile the fragments into a dated release section and
consume them. For example, on `1.2-maintenance` with 1.2.7 pending:

~~~~ bash
sacho release 1.2.7
sacho check
git diff --stat
git diff -- CHANGES.md changes.d
~~~~

The date defaults to the current local calendar date; use `--date YYYY-MM-DD`
when the release requires a specific date. Use `--allow-empty` only for an
intentional release with no changelog entries.

Commit *CHANGES.md* together with the consumed fragment deletions and any
change to *changes.d/next*, plus any package metadata changed when correcting
the release version. Use the message `Release 1.2.7`. Follow the repository's
commit and AI-disclosure rules. Do not commit just the rendered
changelog while leaving its source fragments pending.

Tag this release commit before preparing the next version:

~~~~ bash
git tag -m "Optique 1.2.7" 1.2.7
~~~~

Always provide a tag message with `-m`, including for signed tags. For a
major/minor release, use its version throughout, for example
`sacho release 1.3.0` and `git tag -m "Optique 1.3.0" 1.3.0`.

Do not use `sacho release --next` here. Prepare the next version in a separate
commit with `bump-version`, so the release tag contains the released package
versions and the next-version commit updates the manifests and changelog
metadata together.


Prepare the next version and push
---------------------------------

On a maintenance branch, advance to the next patch version:

~~~~ bash
mise run bump-version 1.2.8
mise run check:versions
sacho check
git diff --stat
~~~~

On `main` after 1.3.0, use `mise run bump-version 1.4.0`, or the next major
version if that is the planned development line. The task creates the next
unreleased section through `sacho next`; do not add a heading manually or run
`sacho next` separately.

Review and commit all version changes together: package metadata,
*changes.d/next*, and *CHANGES.md*. Use `Version bump` with `[ci skip]` in a
separate paragraph, plus the required disclosure trailer. Run `mise test`
before this commit as required by the repository.

Push the release tag and the updated branch:

~~~~ bash
git push dahlia 1.2.7 1.2-maintenance
~~~~

Tag pushes trigger the publishing workflow in *.github/workflows/main.yaml*.
Verify that the tag's workflow succeeds, including the `publish` job for JSR/npm
and the `public-docs` job, before reporting the release as published.

For a major/minor release, push its tag and `main`, then create the maintenance
branch from the release tag, not from the next-version commit:

~~~~ bash
git push dahlia 1.3.0 main
git switch -c 1.3-maintenance 1.3.0
mise run bump-version 1.3.1
mise run check:versions
sacho check
mise test
~~~~

Commit the first patch-version preparation with the same version-bump message
and push `1.3-maintenance`.


Merge patch releases forward
----------------------------

Merge each patch release into newer maintenance branches in order, then into
`main`. Merge the release tag, not the older branch's next-version commit.
Inspect available branches with `git branch -a --list '*-maintenance'`.

For example, to bring 1.2.7 into an existing `1.3-maintenance` branch:

~~~~ bash
git switch 1.3-maintenance
git pull --ff-only dahlia 1.3-maintenance
git merge --no-commit --no-ff 1.2.7
~~~~

Resolve conflicts while retaining the receiving branch's package versions and
*changes.d/next*. Sacho's configured merge driver preserves the receiving
unreleased region and adds the released section at its version position.
Review the result even when Git reports no conflict.

On newer maintenance branches, include the fixes in their next patch notes by
carrying the released entries back into fragments. Before running `carry`,
check for existing *carried-from-1.2.7.md* fragments: the command replaces them.

~~~~ bash
sacho carry 1.2.7
sacho sync
sacho fmt
sacho preview
sacho check
mise test
~~~~

`carry` creates package-specific *carried-from-1.2.7.md* fragments. Edit them
if the receiving branch needs different wording, then synchronize again. Do not
copy bullets or reference link definitions directly into *CHANGES.md*.

Complete the merge commit, including carried fragments and the synchronized
changelog. Confirm the receiving branch's next version and core manifest version
match, using the checks in “Prepare the branch”. Then repeat “Finalize and tag
the release” and
the maintenance-branch steps in “Prepare the next version and push”, using its
pending patch version. Merge the new release tag into the next newer
maintenance branch.

At `main`, merge the last release tag, including its code fixes and released
changelog section. If there is no newer maintenance branch, use the original
release tag. Apply the same conflict handling, but *do not run `sacho carry`*.
Keep main's existing fragments and next version; the imported released section
records the patch fixes without duplicating them in the next major/minor
release notes. Run `sacho sync`, `sacho check`, and `mise test`, complete the
merge commit, and push `main`.
