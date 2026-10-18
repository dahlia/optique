skill-notes command reference
=============================

All file paths resolve from the current working directory. INPUT `-` means
stdin. FILE after `--output` is always a literal filesystem path: `--output -`
creates a file named *-*; it does not write contents to stdout. Use `--` before
an input path beginning with a hyphen. The examples below cover the maintained
forms; they are not a claim that every accepted token spelling is listed.

Each successful invocation prints one LF-terminated line to stdout, no stderr,
and exits with 0. Invalid syntax exits with 1 before input/output operations.
A missing/unreadable input, missing output parent or directory input
exits with 1 and `skill-notes: File operation failed.` on stderr. An existing
output, including a directory, exits with 1 and
`skill-notes: Destination already exists.` on stderr. No output file is created
when input reading fails. A late write failure can leave a partial new file;
failure injection for that case is untested.

<!-- example: missing-input -->

~~~~ bash
skill-notes count missing.txt
~~~~

~~~~ text
skill-notes: File operation failed.
~~~~

Exit status: 1 (stderr).

<!-- example: existing-output -->

~~~~ bash
skill-notes save notes.txt --output notes.txt
~~~~

~~~~ text
skill-notes: Destination already exists.
~~~~

Exit status: 1 (stderr).


Redirected count
----------------

The shell supplies *notes.txt* as stdin, and count reads until EOF:

<!-- example: count-stdin -->

~~~~ bash
skill-notes count - < notes.txt
~~~~

~~~~ text
{"lines":2}
~~~~

Exit status: 0 (stdout).


File-to-file save
-----------------

This reads *notes.txt* and creates *copy.txt* without replacing an existing
file:

<!-- example: save-file -->

~~~~ bash
skill-notes save notes.txt --output copy.txt
~~~~

~~~~ text
Saved 11 bytes.
~~~~

Exit status: 0 (stdout).

An output named *-* is a literal path, created exclusively:

<!-- example: save-dash -->

~~~~ bash
skill-notes save notes.txt --output -
~~~~

~~~~ text
Saved 11 bytes.
~~~~

Exit status: 0 (stdout).

[Executable examples] record exact argv, UTF-8 stdin, stdout, stderr, status and
expected parsed values. The bundle tests compare these records to each displayed
command/output pair and to the executable; they do not generate workflow
effects.

[Executable examples]: references/examples.json
