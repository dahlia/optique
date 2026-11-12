Converting a file with an explicit output policy
================================================

This example converts a tab-separated file to CSV.  The conversion itself is
deliberately small; the example is about the decisions around it: a required
input, an optional output whose name is derived when omitted, and what happens
when the output already exists.  The cookbook recipe
[file conversion with a derived output name] introduces the parser; this
directory contains the complete, tested program.

~~~~ text
tsv-to-csv [-o/--output OUTPUT] [-f/--force] INPUT
~~~~

 -  `INPUT` must be an existing file.
 -  `-o`, `--output` names the CSV file.  When omitted, the output is `INPUT`
    with its `.tsv` extension replaced by `.csv`, or with `.csv` appended to
    any other name.
 -  `-f`, `--force` replaces an existing output.

On success the program writes the output path to stdout and exits 0.  Every
diagnostic, including a refused overwrite, goes to stderr with a
`tsv-to-csv:` prefix and exit status 1.  Parse errors also exit 1, with usage
on stderr.

[file conversion with a derived output name]: https://optique.dev/cookbook.html#file-conversion-with-a-derived-output-name


Run from a checkout
-------------------

Start at the repository root with the toolchains from [mise] installed, then
create a sample input:

~~~~ bash
mise install
mise tsv-to-csv:deps
mkdir -p tmp/tsv-to-csv
printf 'name\tnote\nAda\tfirst, programmer\n' > tmp/tsv-to-csv/data.tsv
~~~~

The default destination is derived from the input:

~~~~ bash
deno run --allow-read --allow-write --allow-env \
  examples/tsv-to-csv/src/cli.ts tmp/tsv-to-csv/data.tsv
# stdout: tmp/tsv-to-csv/data.csv
~~~~

An explicit destination is used as given:

~~~~ bash
deno run --allow-read --allow-write --allow-env \
  examples/tsv-to-csv/src/cli.ts tmp/tsv-to-csv/data.tsv -o tmp/tsv-to-csv/report.csv
# stdout: tmp/tsv-to-csv/report.csv
~~~~

Running the first command again refuses to replace *data.csv*, because the
destination now exists.  The existing file is left unchanged:

~~~~ bash
deno run --allow-read --allow-write --allow-env \
  examples/tsv-to-csv/src/cli.ts tmp/tsv-to-csv/data.tsv < /dev/null
# stderr: tsv-to-csv: tmp/tsv-to-csv/data.csv already exists; use --force to replace it.
# exit status: 1
~~~~

`--force` replaces it:

~~~~ bash
deno run --allow-read --allow-write --allow-env \
  examples/tsv-to-csv/src/cli.ts --force tmp/tsv-to-csv/data.tsv
~~~~

The same commands work with `node examples/tsv-to-csv/src/cli.ts` and
`bun examples/tsv-to-csv/src/cli.ts`.  Node.js and Bun resolve the workspace
packages from their built *dist/* output, so run `mise build` first.

[mise]: https://mise.jdx.dev/


Overwrite policy
----------------

Paths in this section are relative to *examples/tsv-to-csv*.

*src/app.ts* reads and converts the input first, then tries to create the
destination with the `wx` flag, which fails if anything already exists at that
path.  Checking for the destination and creating it is therefore a single
filesystem operation; there is no gap in which another process could create
the file between a check and the write.  Only when that fails does the
program decide what to do with the existing file:

 -  With `--force`, it replaces the file.
 -  Without `--force`, when both stdin and stderr are terminals, it asks
    `Overwrite OUTPUT? [y/N]` on stderr.  Any answer other than `y` or `yes`
    keeps the file, and so does ending the input with Ctrl-D.  The question
    comes immediately before the write, after the input has been read and
    converted, so a failing input never leads to a prompt.
 -  Otherwise, as in scripts, pipelines, and CI, it refuses and exits 1.

A destination that is not a regular file, such as a directory or a FIFO, is
rejected even with `--force`.  Replacing a regular file writes the CSV to a
temporary file in the same directory and renames it over the destination.
The rename replaces the directory entry rather than the file's contents, so
other hard links to the old file and the target of a symbolic link are left
as they were.  The new file gets default permissions instead of the old
file's.  If a write fails, for example because the disk is full, the
program removes the file it created, whether that is the new destination or
the temporary file, so a failed run does not leave a partial CSV that the
next run would refuse to replace.

The prompt is asked from *src/cli.ts* through *src/confirm.ts*, in the
application code that runs after parsing, not in a value parser.  `run()` exits
the process for `--help`, `--version`, and parse errors before that code runs,
so these never read the input contents, write a file, or ask a question.

The output option does not use `path({ mustNotExist: true })`.  That check
runs during parsing and only observes the filesystem at that moment; it does
not reserve the name, so a file created a moment later would still be
overwritten by a plain write.  It would also reject the path before
`--force` could take effect, and it never applies to the derived default,
which is not parsed at all.  The `wx` write covers all three cases.

### Same-file protection

Converting a file onto itself would replace the input.  Before replacing an
existing destination, *src/app.ts* compares the device and inode numbers that
`stat()` reports for the input and the destination.  This rejects the input
under a different spelling (`./data.tsv`), a hard link, and a symbolic link
to it, even with `--force`.  A derived destination can never equal the input
path, because it always ends in `.csv` while the extension it replaces is
`.tsv`.

The check has limits.  It is a snapshot taken before the prompt, so another
process could still swap either path afterward.  Because the replacement
renames a new file into place, such a swap cannot make the program write into
the input, but the check may then have looked at a different file than the
one replaced.  It also relies on
the filesystem reporting stable device and inode numbers, which some network
and virtual filesystems do not.  A plain string comparison would be weaker
still: it misses links, `..` segments, and case-insensitive filesystems.


Tests
-----

~~~~ bash
mise tsv-to-csv:test
~~~~

The task builds the workspace dependencies and runs the tests under Deno,
Node.js, and Bun.  *src/convert.test.ts* covers the conversion and the
derived name.  *src/confirm.test.ts* checks the accepted answers and that
ending the input declines.  *src/app.test.ts* uses temporary directories to
check the default and explicit destinations, refusal with the destination
contents unchanged, forced replacement, both answers to the confirmation, and
rejection of the input under another spelling, through a hard link, and through
a symbolic link.  It also checks that replacing a destination leaves other hard
links and symbolic link targets unchanged, cannot be redirected into the input
while the question is open, and rejects a directory or FIFO.  *src/cli.test.ts*
runs *src/cli.ts* as a subprocess and checks stdout, stderr, and exit status
for the same commands as above, and that help, version, and parse errors leave
every file in the directory as it was. On Linux it also runs the CLI under a
zero file size limit to check that a failed write leaves no partial output.
