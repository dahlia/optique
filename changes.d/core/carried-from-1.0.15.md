---
links:
  '#1030': https://github.com/dahlia/optique/issues/1030
  '#1031': https://github.com/dahlia/optique/issues/1031
  '#1032': https://github.com/dahlia/optique/issues/1032
  '#1033': https://github.com/dahlia/optique/pull/1033
  '#1034': https://github.com/dahlia/optique/pull/1034
  '#1035': https://github.com/dahlia/optique/issues/1035
  '#1036': https://github.com/dahlia/optique/issues/1036
  '#1037': https://github.com/dahlia/optique/issues/1037
  '#1038': https://github.com/dahlia/optique/issues/1038
  '#1039': https://github.com/dahlia/optique/issues/1039
  '#1040': https://github.com/dahlia/optique/issues/1040
  '#1041': https://github.com/dahlia/optique/issues/1041
  '#1042': https://github.com/dahlia/optique/issues/1042
  '#1043': https://github.com/dahlia/optique/issues/1043
  '#1044': https://github.com/dahlia/optique/issues/1044
  '#1045': https://github.com/dahlia/optique/issues/1045
  '#1046': https://github.com/dahlia/optique/issues/1046
  '#1047': https://github.com/dahlia/optique/issues/1047
  '#1048': https://github.com/dahlia/optique/issues/1048
  '#1049': https://github.com/dahlia/optique/issues/1049
  '#1051': https://github.com/dahlia/optique/issues/1051
  '#1052': https://github.com/dahlia/optique/issues/1052
  '#1053': https://github.com/dahlia/optique/issues/1053
  '#1054': https://github.com/dahlia/optique/issues/1054
  '#1055': https://github.com/dahlia/optique/issues/1055
  '#1056': https://github.com/dahlia/optique/issues/1056
  '#1057': https://github.com/dahlia/optique/pull/1057
  '#1058': https://github.com/dahlia/optique/pull/1058
  '#1059': https://github.com/dahlia/optique/pull/1059
  '#1060': https://github.com/dahlia/optique/pull/1060
  '#1061': https://github.com/dahlia/optique/pull/1061
  '#1062': https://github.com/dahlia/optique/pull/1062
  '#1063': https://github.com/dahlia/optique/pull/1063
  '#1064': https://github.com/dahlia/optique/pull/1064
  '#1065': https://github.com/dahlia/optique/pull/1065
  '#1066': https://github.com/dahlia/optique/pull/1066
  '#1067': https://github.com/dahlia/optique/pull/1067
  '#1068': https://github.com/dahlia/optique/pull/1068
  '#1069': https://github.com/dahlia/optique/pull/1069
  '#1070': https://github.com/dahlia/optique/pull/1070
  '#1071': https://github.com/dahlia/optique/pull/1071
  '#1072': https://github.com/dahlia/optique/pull/1072
  '#1073': https://github.com/dahlia/optique/pull/1073
  '#1075': https://github.com/dahlia/optique/pull/1075
  '#1076': https://github.com/dahlia/optique/pull/1076
  '#1077': https://github.com/dahlia/optique/pull/1077
  '#1078': https://github.com/dahlia/optique/pull/1078
  '#1079': https://github.com/dahlia/optique/pull/1079
---
 -  Fixed Bash completion of joined option values with `=` for long `-`
    options or `:` for `/` options and default or customized word-break
    settings, including `:`/`@` in values or option names. Completion respects
    the cursor position, stops at unquoted shell operators, and decodes
    quoted or escaped values, including incomplete ANSI-C control escapes,
    without executing shell substitutions. File values preserve their full
    prefix and filtering metadata when option names overlap, unquoted tilde
    expansion after quoted or split option names, and quoted path prefixes.
    Exact literal candidates, including dot-prefixed values, remain available
    alongside file suggestions when hidden files are excluded. Hidden candidates
    allowed by one file suggestion remain available alongside other file
    suggestions. Option names quoted or escaped from their first character,
    partial option names, and literal values resembling file
    completion markers also complete correctly. File suggestions with fixed
    search patterns enumerate matching paths instead of inserting the pattern
    as literal text, retain wildcard filters as values are typed, and honor
    hidden-file settings without duplicate directory candidates, including on
    older Bash versions. Fixed-pattern completion also preserves a typed `./`
    prefix or its omission even for empty values, completes explicitly typed
    hidden directories, follows `nocaseglob` when narrowing candidates, and
    removes duplicate matches from overlapping patterns. Control characters in
    joined fixed patterns no longer split or corrupt completion records.
    Wildcard directory components remain navigable, and completion filters even
    partial or unrelated typed prefixes instead of replacing them with all
    matches. Large candidate sets remain responsive without changing suggestion
    order. Typed tilde or absolute path forms remain intact when fixed patterns
    use a different spelling. Bare unquoted `~` values also complete
    home-relative patterns. Fixed Bash patterns treat brackets, backslashes,
    and extended-glob operators literally alongside `*`/`?` wildcards.
    Navigating into suggested directories retains fixed basename filters for
    subsequent completions, including directory-only patterns and patterns
    rooted directly at `/`. Unquoted fixed wildcard patterns still expand when
    entered in full, while quoted or escaped wildcard prefixes remain literal.
    A lone `.` prefix also completes `./` patterns, and navigation through `..`
    no longer offers descendants outside matching pattern bases while allowing
    parent-relative patterns and navigation that stays within their bases.
    Completion candidates remain available when `sort` is missing.
    [[#1031], [#1032], [#1033], [#1079]]

 -  Fixed Bash file completion to quote filenames containing spaces or shell
    metacharacters, preserving them as literal arguments when the completed
    command runs.  Directory paths remain open for further completion.

    Bash 3.2 lacks `compopt`, so filename processing applies to all suggestions
    there.  On that version, a literal suggestion matching
    a local directory receives a trailing slash instead of a space.
    [[#1030], [#1034]]

 -  Fixed Nushell completion scripts generated by `nu.generateScript()` to
    pass fixed callback arguments containing apostrophes to the CLI intact.
    Previously, an argument such as `it's` arrived as `its`.
    [[#1039], [#1057]]

 -  Fixed Nushell completion to pass the command line to the CLI with the
    same arguments Nushell itself would pass.  Empty quoted arguments such as
    `""` are no longer dropped, so options after them complete again.
    Escaped quotes in double-quoted strings, backtick strings, and raw strings
    such as `r#'...'#` are now decoded instead of being split or merged with
    later arguments, and a space typed inside an unfinished quoted value no
    longer starts a new argument.
    [[#1041], [#1065]]

 -  Fixed Nushell completion to quote suggested values and file names that
    contain spaces, quotes, or other characters Nushell would interpret, so
    each completed value stays a single argument with its original text.
    The completion menu still shows the values unquoted.
    [[#1038], [#1076]]

    Because quotes keep Nushell from expanding `~`, a quoted path typed
    under the home directory is inserted with the home directory spelled out.

 -  Fixed Nushell file completion leaving out symbolic links to files and
    directories.  A link is now classified by its target, so a directory link
    gets a trailing slash for navigation, while extension filters still match
    the link's own name.  Broken links stay excluded when completion is
    limited to files or directories.
    [[#1042], [#1063]]

 -  Fixed Nushell file completion to treat square brackets in a typed path as
    literal characters.  Completing `report[1]` now suggests *report\[1\].txt*
    instead of matching *report1.txt* as if `[1]` were a glob character class.
    [[#1040], [#1060]]

 -  Fixed Nushell, zsh, and PowerShell file completion to retain fixed glob
    filters while narrowing a path prefix.  Directories remain available for
    navigation.
    [[#1049], [#1077]]

 -  Fixed PowerShell and Nushell file completion to match compound extensions
    such as `.tar.gz`, while keeping directories available for navigation.
    [[#1048], [#1061]]

 -  Fixed PowerShell completion for quoted literal values and file paths,
    including unfinished quotes and joined option values, so suggestions
    remain literal arguments when inserted.
    [[#1045], [#1070]]

 -  Fixed PowerShell completion to ignore arguments after the cursor when
    completing an earlier argument, keeping later arguments intact.
    [[#1043], [#1069]]

 -  Fixed PowerShell completion to quote literal values and file/directory
    paths when needed, preserving their argument values when the completed
    command runs.  Completion labels remain readable, and completing a quoted
    directory keeps the cursor ready for its child paths.
    [[#1046], [#1068]]

 -  Fixed PowerShell file completion to respect case in extension filters,
    matching the path parser's case sensitivity.
    [[#1044], [#1067]]

 -  Fixed Zsh completion for regular-file suggestions, including
    `path({ type: "file" })`, to exclude named pipes and other non-regular paths
    even without an extension filter.  Symlinks to regular files and directory
    navigation remain available.
    [[#1053], [#1073]]

    File suggestions now consistently use the `files`/`directories` completion
    tags.  The `file-patterns` style and `globbed-files`/`all-files` tag styles
    no longer control suggestions without an extension filter.  The
    `list-dirs-first` style still lists directories before regular files.

 -  Fixed Zsh completion to match option values inside single/double quotes,
    including values with literal backslashes and file paths with spaces,
    while preserving their quoting context and backend file-pattern globs.
    [[#1056], [#1078]]

 -  Fixed Zsh completion to offer initial matches for relative file globs such
    as _tmp/fixtures/\*.txt_ when the current value is empty.  This also
    applies to suggestions with `type: "any"`, which can match FIFOs.  File
    extension filters still apply to these matches, and subdirectories remain
    available for navigation.  Initial matches honor the `tag-order`,
    `list-dirs-first`, and `recursive-files` styles.  Directory-only
    suggestions now also offer initial matches, limited to directories whose
    names match the glob.  Initial glob matching supports only `*` and `?`
    wildcards in the filename; filename patterns containing brackets or
    backslashes retain their previous completion behavior.
    [[#1054], [#1075]]

 -  Fixed Zsh completion to preserve literal values containing colons or
    backslashes, including URL choices.  Regenerate and reload existing Zsh
    completion scripts to apply the fix.
    [[#1055], [#1058]]

 -  Fixed Zsh literal completion with `COMPLETE_IN_WORD` enabled to complete
    values in the middle of a word, matching the text before and after the
    cursor.
    [[#1052], [#1072]]

 -  Fixed fish completion to decode quotes and backslash escapes in the word
    being completed, so `--format "tw` or `--file two\ w` now offers the same
    choices and file names as the unquoted word.  A quoted or escaped `~` now
    stays a literal path, as in fish's own file completion.
    [[#1035], [#1064]]

 -  Fixed fish completion to offer files matching a file suggestion's wildcard
    pattern, such as `*.txt`, `file?.txt`, or `src/*.txt`.  These patterns
    previously produced no candidates.  Hidden entries are now included for
    such patterns when `includeHidden` is enabled, and a pattern under `/`
    now lists the root directory.
    [[#1037], [#1062]]

 -  Fixed fish file completion to suggest filenames that start with a dash,
    such as `-n`, `-e`, or `-s`, which were previously missing from the
    candidates.  Completing dash-prefixed paths no longer prints `basename`
    errors to the terminal either.
    [[#1036], [#1059]]

 -  Fixed shell completion values starting with `__FILE__:` being interpreted
    as file completion requests instead of literal suggestions.
    [[#1051], [#1066]]

    Regenerate saved completion scripts after upgrading.  Custom completion
    producers/adapters must encode/decode the `__LITERAL__:` escape for values
    starting with `__FILE__:` or `__LITERAL__:`.

 -  Fixed zsh/fish completion scripts for program names containing hyphens or
    dots to keep their commands separate when installed together with scripts
    for similarly named programs, such as `foo-bar`, `foo_bar`, and `foo.bar`.
    Regenerate completion scripts for all affected programs after upgrading.
    [[#1047], [#1071]]
