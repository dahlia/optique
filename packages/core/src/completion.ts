import { getJoinedFileSuggestion } from "./internal/joined-file-suggestion.ts";
import { formatMessage } from "./message.ts";
import type { Suggestion } from "./parser.ts";

/**
 * A regular expression pattern for valid program names that can be safely
 * interpolated into shell scripts.
 *
 * The first character must be alphanumeric or underscore.  Subsequent
 * characters may also include hyphens and dots:
 * - Letters (a-z, A-Z)
 * - Numbers (0-9)
 * - Underscore (_)
 * - Hyphen (-) — not as the first character
 * - Dot (.) — not as the first character
 *
 * @internal
 */
const SAFE_PROGRAM_NAME_PATTERN = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/;

/**
 * Validates a program name for safe use in shell scripts.
 *
 * Program names that contain shell metacharacters or other special characters
 * could enable command injection attacks when interpolated into shell scripts.
 * This function ensures only safe characters are used.
 *
 * @param programName The program name to validate.
 * @throws {Error} If the program name contains invalid characters.
 * @internal
 */
function validateProgramName(programName: string): void {
  if (!SAFE_PROGRAM_NAME_PATTERN.test(programName)) {
    throw new Error(
      `Invalid program name for shell completion: "${programName}". ` +
        "Program names must start with an alphanumeric character or " +
        "underscore, and contain only alphanumeric characters, " +
        "underscores, hyphens, and dots.",
    );
  }
}

/**
 * Percent-encodes colons and percent signs in a pattern string so that it
 * can be safely embedded in the colon-delimited `__FILE__` transport format.
 * @param pattern The raw pattern string.
 * @returns The encoded pattern string.
 * @internal
 */
function encodePattern(pattern: string): string {
  return pattern.replace(/%/g, "%25").replace(/:/g, "%3A");
}

/** Escapes literal records that could otherwise be read as Bash directives. */
function encodeBashLiteral(value: string): string {
  const text = sanitizeForTransport(value);
  return /^(?:__FILE__|__JOINED_FILE__|__LITERAL__):/.test(text)
    ? `__LITERAL__:${text}`
    : text;
}

function encodeExtensions(
  extensions: readonly string[] | undefined,
): string {
  return extensions?.map((ext) => ext.replace(/^\./, "")).join(",") ?? "";
}

/**
 * Replaces control characters that would corrupt shell completion protocols.
 * Shell completion formats use tabs as field delimiters and newlines as record
 * delimiters.  Null bytes are used as delimiters in zsh's format.
 * This is used for both suggestion text and descriptions.
 * @param text The string to sanitize.
 * @returns The sanitized string with control characters replaced by spaces.
 * @internal
 */
function sanitizeForTransport(text: string): string {
  return text.replace(/[\t\n\r\0]/g, " ");
}

/**
 * A shell completion generator.
 * @since 0.6.0
 */
export interface ShellCompletion {
  /**
   * The name of the shell.
   */
  readonly name: string;

  /**
   * Generates a shell completion script for the given program name.
   * @param programName The name of the program.
   * @param args The arguments passed to the program.  If omitted, an empty
   *             array is used.
   * @returns The shell completion script.
   */
  generateScript(programName: string, args?: readonly string[]): string;

  /**
   * Encodes {@link Suggestion}s into chunks of strings suitable for the shell.
   * All chunks will be joined without any separator.
   * @param suggestions The suggestions to encode.
   * @returns The encoded suggestions.
   */
  encodeSuggestions(suggestions: readonly Suggestion[]): Iterable<string>;
}

/**
 * The Bash shell completion generator.
 * @since 0.6.0
 */
export const bash: ShellCompletion = {
  name: "bash",
  generateScript(programName: string, args: readonly string[] = []): string {
    validateProgramName(programName);
    const escapedArgs = args.map((arg) => `'${arg.replace(/'/g, "'\\''")}'`)
      .join(" ");
    return `
function _${programName} () {
  COMPREPLY=()
  local __raw_current="\${COMP_WORDS[COMP_CWORD]}"
  local current="" __quote="" __char __next __index __quote_offset=0
  local __file_mode=0
  if [[ $(type -t compopt) == builtin ]]; then
    compopt +o filenames 2>/dev/null || true
  fi
  # Dequote the shell word without evaluating filename contents.  Readline
  # returns escaped words after Tab, and users may start with an open quote.
  for ((__index=0; __index<\${#__raw_current}; __index++)); do
    __char="\${__raw_current:__index:1}"
    if [[ -z "$__quote" ]]; then
      case "$__char" in
        \\\\) ((++__index)); current+="\${__raw_current:__index:1}" ;;
        \\'|\\") __quote="$__char"; __quote_offset=\${#current} ;;
        *) current+="$__char" ;;
      esac
    elif [[ "$__quote" == "'" ]]; then
      if [[ "$__char" == "'" ]]; then
        __quote=""
      else
        current+="$__char"
      fi
    else
      case "$__char" in
        \\") __quote="" ;;
        \\\\)
          __next="\${__raw_current:__index+1:1}"
          case "$__next" in
            \\$|\\\`|\\"|\\\\)
              ((++__index)); current+="$__next" ;;
            *) current+="$__char" ;;
          esac ;;
        *) current+="$__char" ;;
      esac
    fi
  done
  local __tilde_pattern='^(~[a-zA-Z0-9_.+-]*)(/.*)$'
  local __tilde_glob_pattern='^(~[a-zA-Z0-9_.+-]*)(/.*)?$'
  local prev=("\${COMP_WORDS[@]:1:COMP_CWORD-1}")
  # Bash splits unquoted '=' at its default word breaks. Reassemble only
  # adjacent fragments, including further word breaks inside a joined value,
  # leaving whitespace-separated arguments intact.
  local __plain_current="$current" __remove="" __word __joined=0
  local __raw_joined_current="$__raw_current"
  local -a __raw_offsets=() __raw_quotes=()
  if [[ \${COMP_LINE+x} ]]; then
    local -a __words=()
    local __rest="$COMP_LINE" __previous="" __space __valid=1 __i __j=0
    local __shell_quote="" __shell_escape=0 __boundary=0 __previous_boundary=0 __scan __symbol __shell_dollar=0
    # Reconstruct the prefix at the cursor, leaving any suffix to Readline.
    if [[ \${COMP_POINT+x} ]]; then
      __rest="\${COMP_LINE:0:COMP_POINT}"
    fi
    for ((__i=0; __i<=COMP_CWORD; __i++)); do
      __word="\${COMP_WORDS[__i]}"
      __space=0
      while [[ "$__rest" == [[:space:]]* ]]; do
        __space=1
        __rest="\${__rest:1}"
      done
      if (( __i == COMP_CWORD && \${#__rest} < \${#__word} )); then
        __word="\${__word:0:\${#__rest}}"
      fi
      if [[ "\${__rest:0:\${#__word}}" != "$__word" ]]; then
        __valid=0
        break
      fi
      # Quoted or escaped operators belong to words; bare operators separate
      # shell syntax even when no whitespace surrounds a redirection.
      __boundary=0
      for ((__scan=0; __scan<\${#__word}; __scan++)); do
        __symbol="\${__word:__scan:1}"
        if (( __shell_escape )); then
          __shell_escape=0
        elif [[ "$__shell_quote" == ansi ]]; then
          if [[ "$__symbol" == '\\' ]]; then __shell_escape=1
          elif [[ "$__symbol" == "'" ]]; then __shell_quote=""; fi
        elif [[ "$__shell_quote" == "'" ]]; then
          [[ "$__symbol" == "'" ]] && __shell_quote=""
        elif [[ "$__symbol" == '\\' ]]; then
          __shell_escape=1
        elif [[ -n "$__shell_quote" ]]; then
          [[ "$__symbol" == "$__shell_quote" ]] && __shell_quote=""
        else
          case "$__symbol" in
            "'")
              if (( __shell_dollar )); then __shell_quote=ansi
              else __shell_quote="'"; fi ;;
            '"') __shell_quote='"' ;;
            '$') __shell_dollar=1 ;;
            '>'|'<'|'|'|'&'|';'|'('|')') __boundary=1 ;;
          esac
        fi
        [[ "$__symbol" == '$' && -z "$__shell_quote" ]] || __shell_dollar=0
      done
      if (( __i > 1 && !__space && !__boundary && !__previous_boundary )) &&
          { [[ -n "$__word" && -z "\${__word//=/}" ]] ||
            [[ -n "$__previous" && -z "\${__previous//=/}" ]] ||
            [[ "\${__words[__j-1]}" == [-/+]* ]] ||
            [[ "$__word" == =* && "\${__words[__j-1]}" == [-/+]* ]]; }; then
        __words[__j-1]+="$__word"
      else
        __words[__j]="$__word"
        ((++__j))
      fi
      __rest="\${__rest:\${#__word}}"
      __previous="$__word"
      __previous_boundary=$__boundary
    done
    if (( __valid )); then
      current="\${__words[__j-1]}"
      __raw_joined_current="$current"
      prev=("\${__words[@]:1:__j-2}")
      # Bash passes the fragment Readline will replace as the second argument,
      # which is empty when the cursor follows a word-break character.
      if [[ \${2+x} ]]; then
        __remove="\${current:0:\${#current}-\${#2}}"
      elif [[ -n "$__raw_current" && -z "\${__raw_current//=/}" ]]; then
        __remove="$current"
      else
        __remove="\${current:0:\${#current}-\${#__raw_current}}"
      fi
      # Decode joined shell words without evaluating substitutions. Keep quote
      # state across the reassembled fragments and decode the preserved prefix
      # separately so trimming uses the same representation as suggestions.
      __words[__j]="$__remove"
      local __decoded __decoded_option=0 __before_quote __join_quote __char __next __k __ansi __part __digits __code __join_quote_offset
      for ((__i=1; __i<=__j; __i++)); do
        __word="\${__words[__i]}"
        __decoded=""; __join_quote=""; __join_quote_offset=0
        for ((__k=0; __k<\${#__word}; __k++)); do
          __char="\${__word:__k:1}"
          __before_quote="$__join_quote"
          if [[ -z "$__join_quote" ]]; then
            case "$__char" in
              '\\') ((++__k)); __decoded+="\${__word:__k:1}" ;;
              '$')
                if [[ "\${__word:__k+1:1}" == "'" ]]; then
                  __join_quote=ansi; __join_quote_offset=\${#__decoded}; __ansi=""; ((++__k))
                elif [[ "\${__word:__k+1:1}" == '"' ]]; then
                  __join_quote='"'; __join_quote_offset=\${#__decoded}; ((++__k))
                else __decoded+="$__char"; fi ;;
              "'"|'"') __join_quote="$__char"; __join_quote_offset=\${#__decoded} ;;
              *) __decoded+="$__char" ;;
            esac
          elif [[ "$__join_quote" == ansi ]]; then
            if [[ "$__char" == "'" ]]; then
              printf -v __part '%b' "$__ansi"
              __decoded+="$__part"; __join_quote=""
            elif [[ "$__char" == '\\' ]]; then
              ((++__k)); __next="\${__word:__k:1}"
              case "$__next" in
                [0-7])
                  __digits="$__next"
                  while (( \${#__digits} < 3 )) && [[ "\${__word:__k+1:1}" == [0-7] ]]; do
                    ((++__k)); __digits+="\${__word:__k:1}"
                  done
                  __ansi+='\\0'"$__digits" ;;
                c)
                  __next="\${__word:__k+1:1}"
                  if [[ -n "$__next" && "$__next" != "'" ]]; then
                    ((++__k)); printf -v __code '%d' "'$__next"
                    if [[ "$__next" == '?' ]]; then __code=127
                    else __code=$((__code & 31)); fi
                    printf -v __part '\\\\%03o' "$__code"
                    __ansi+="$__part"
                  else __ansi+='\\\\c'; fi ;;
                "'"|'"'|'?') __ansi+="$__next" ;;
                *) __ansi+='\\'"$__next" ;;
              esac
            else __ansi+="$__char"; fi
          elif [[ "$__join_quote" == "'" ]]; then
            if [[ "$__char" == "'" ]]; then __join_quote=""
            else __decoded+="$__char"; fi
          else
            case "$__char" in
              '"') __join_quote="" ;;
              '\\')
                __next="\${__word:__k+1:1}"
                case "$__next" in
                  '$'|'\`'|'"'|'\\') ((++__k)); __decoded+="$__next" ;;
                  *) __decoded+="$__char" ;;
                esac ;;
              *) __decoded+="$__char" ;;
            esac
          fi
          if (( __i == __j - 1 )) &&
              { [[ ! \${__raw_offsets[\${#__decoded}]+x} ]] ||
                [[ -n "$__before_quote" && -z "$__join_quote" ]]; }; then
            __raw_offsets[\${#__decoded}]=$((__k + 1))
            __raw_quotes[\${#__decoded}]="$__join_quote"
          fi
        done
        if [[ "$__join_quote" == ansi ]]; then
          printf -v __part '%b' "$__ansi"
          __decoded+="$__part"
        fi
        # Shell syntax may precede the option prefix. Decide from decoded text,
        # retaining the existing native-file handling for non-option words.
        if [[ "$__decoded" == [-/+]* ]] || (( __i == __j && __decoded_option )); then
          if (( __i == __j - 1 )); then
            __decoded_option=1
            __quote="$__join_quote"
            [[ "$__quote" == ansi ]] && __quote="'"
            __quote_offset=$__join_quote_offset
          fi
          __words[__i]="$__decoded"
        fi
      done
      if [[ "\${__words[__j-1]}" == -*=* || "\${__words[__j-1]}" == /*:* || "\${__words[__j-1]}" != "$__raw_current" ]]; then
        current="\${__words[__j-1]}"
        __joined=1
      else
        current="$__plain_current"
        __words[__j]=""
      fi
      prev=("\${__words[@]:1:__j-2}")
      __remove="\${__words[__j]}"
    fi
  fi

  # Joined file directives retain the exact option prefix and metadata chosen
  # by the parser; do not infer option boundaries through speculative retries.
  local __protocol_current="$__raw_current"
  (( __joined )) && __protocol_current="$current"
  local -a __lines=() __replies=()
  local line __reply_prefix="" __file_current="$current" __literal=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -n "$line" ]] && __lines+=("$line")
  done < <(${programName} ${escapedArgs} "\${prev[@]}" "$__protocol_current" 2>/dev/null)
  for line in "\${__lines[@]}"; do
    COMPREPLY=()
    __reply_prefix=""
    __file_current="$current"
    __literal=0
    if [[ "$line" == __LITERAL__:* ]]; then
      line="\${line#__LITERAL__:}"
      __literal=1
    elif [[ "$line" == __JOINED_FILE__:* ]]; then
      line="\${line#__JOINED_FILE__:}"
      __reply_prefix="\${line%%:*}"
      __reply_prefix="\${__reply_prefix//%3A/:}"
      __reply_prefix="\${__reply_prefix//%25/%}"
      line="__FILE__:\${line#*:}"
      __file_current="\${current:\${#__reply_prefix}}"
    fi
    local __raw_file_current="$__raw_current" __file_quote_offset=$__quote_offset __file_tilde_quoted=0
    if [[ -n "$__reply_prefix" ]]; then
      local __raw_offset="\${__raw_offsets[\${#__reply_prefix}]:-\${#__reply_prefix}}"
      __raw_file_current="\${__raw_joined_current:__raw_offset}"
      # Quoting may start before the option name and remain active at the
      # delimiter. Keep that context when deciding whether tilde is literal.
      if [[ -n "\${__raw_quotes[\${#__reply_prefix}]-}" ]]; then
        __file_tilde_quoted=1
      fi
      if (( __file_quote_offset >= \${#__reply_prefix} )); then
        __file_quote_offset=$((__file_quote_offset - \${#__reply_prefix}))
      fi
    fi
    if [[ $__literal == 0 && "$line" == __FILE__:* ]]; then
      # Parse file completion directive: __FILE__:type:extensions:pattern:hidden
      IFS=':' read -r _ type extensions pattern hidden <<< "$line"
      extensions="\${extensions//,\\./,}"; extensions="\${extensions#.}"
      pattern="\${pattern//%3A/:}"; pattern="\${pattern//%25/%}"
      local __reply_start=\${#COMPREPLY[@]}

      # path() echoes the raw shell word as its pattern.  Once dequoted,
      # use the literal current-word prefix instead of the escaped pattern.
      if [[ ( "$pattern" == "$__raw_file_current" && "$__file_current" != "$__raw_file_current" ) ||
            ( -n "$__reply_prefix" && "$pattern" == "$__file_current" ) ]]; then
        pattern=""
      fi

      # Save and adjust glob/shell options for safe file completion
      local __dotglob_was_set=0 __failglob_was_set=0 __noglob_was_set=0
      local __globignore_was_set=0 __saved_globignore="\${GLOBIGNORE-}"
      [[ \${GLOBIGNORE+x} == x ]] && __globignore_was_set=1
      shopt -q dotglob && __dotglob_was_set=1
      shopt -q failglob && __failglob_was_set=1
      [[ $- == *f* ]] && __noglob_was_set=1
      # Unset GLOBIGNORE before enabling dotglob because unsetting
      # GLOBIGNORE implicitly clears dotglob in Bash
      shopt -u failglob 2>/dev/null
      set +f
      unset GLOBIGNORE

      # Expand tilde prefix for file globbing
      local __glob_current="$__file_current" __tilde_prefix="" __tilde_expanded=""
      if [[ $__file_tilde_quoted == 0 && "$__raw_file_current" == "~"* && "$__file_current" =~ $__tilde_pattern ]]; then
        __tilde_prefix="\${BASH_REMATCH[1]}"
        eval "__tilde_expanded=\$__tilde_prefix" 2>/dev/null || true
        if [[ -n "$__tilde_expanded" && "$__tilde_expanded" != "$__tilde_prefix" ]]; then
          __glob_current="\${__tilde_expanded}\${__file_current#\$__tilde_prefix}"
        else
          __tilde_prefix=""
        fi
      fi

      # When a pattern is specified, use it as the glob base instead of the
      # current word so that completions enumerate the pattern's directory.
      # However, if the user has already typed beyond the pattern (e.g.,
      # pattern="src/" and current="src/ma"), preserve the typed suffix
      # for incremental filtering.
      local __from_pattern=0 __filter_pattern=0 __pattern_prefix=""
      local __pattern_tilde_prefix="" __pattern_tilde_expanded=""
      if [[ -n "$pattern" ]]; then
        # Normalize leading ./ so that ./src/ma matches pattern src/
        local __norm_current="\${__file_current#./}"
        local __norm_pattern="\${pattern#./}"
        # For wildcard patterns, compare only the directory prefix before
        # any wildcards so that typing src/ma narrows src/*.ts correctly
        local __compare_pattern="$__norm_pattern"
        if [[ "$__compare_pattern" == *[\*\?]* ]]; then
          __compare_pattern="\${__compare_pattern%%[\*\?]*}"
          [[ "$__compare_pattern" == */* ]] && __compare_pattern="\${__compare_pattern%/*}/" || __compare_pattern=""
        fi
        local __extends_pattern=0
        if [[ ( -n "$__compare_pattern" || -n "$__norm_current" ) && \${#__norm_current} -ge \${#__compare_pattern} && "\${__norm_current:0:\${#__compare_pattern}}" == "$__compare_pattern" && "$__file_current" != "$pattern" ]]; then
          __extends_pattern=1
        fi
        if (( __extends_pattern )) && [[ "$__norm_pattern" != *[\*\?]* ]]; then
          # User has typed beyond or an equivalent form of the pattern
          true
        else
          # Wildcards keep their file filter while the typed prefix narrows
          # the resulting paths. Save the expanded prefix before using pattern.
          if [[ "$__norm_pattern" == *[\*\?]* ]]; then
            __filter_pattern=1
            __pattern_prefix="$__glob_current"
            __pattern_tilde_prefix="$__tilde_prefix"
            __pattern_tilde_expanded="$__tilde_expanded"
          fi
          __from_pattern=1
          # Reset tilde state from the current-word expansion so that a
          # non-tilde pattern is not rewritten through stale tilde state
          __tilde_prefix=""
          __tilde_expanded=""
          __glob_current="$pattern"
          if [[ "$pattern" =~ $__tilde_glob_pattern ]]; then
            __tilde_prefix="\${BASH_REMATCH[1]}"
            eval "__tilde_expanded=\$__tilde_prefix" 2>/dev/null || true
            if [[ -n "$__tilde_expanded" && "$__tilde_expanded" != "$__tilde_prefix" ]]; then
              __glob_current="\${__tilde_expanded}\${pattern#\$__tilde_prefix}"
            else
              __tilde_prefix=""
            fi
          fi
          # If the glob base is a directory without a trailing slash,
          # append one so that the glob enumerates its contents
          if [[ -d "$__glob_current" && "$__glob_current" != */ ]]; then
            __glob_current="$__glob_current/"
          fi
        fi
      fi

      # Enable dotglob when hidden files are requested, or when the user
      # is already navigating inside a hidden directory (e.g., ~/.config/nvim/)
      # This runs after tilde expansion so that paths like ~/.config/ are
      # checked against the expanded path, not the literal ~ string.
      local __inside_hidden_path=0
      local __hidden_directory_pattern='/[.]([^./][^/]*|[.][^/]+)/'
      if [[ "/\${__glob_current%/}/" =~ $__hidden_directory_pattern ||
            "/\${__pattern_prefix%/}/" =~ $__hidden_directory_pattern ]]; then
        __inside_hidden_path=1
      fi
      # Also check if the current prefix explicitly targets hidden entries
      # (e.g., user typed "." or ".e" to complete .env)
      local __prefix_targets_hidden=0
      local __prefix_base="\${__glob_current##*/}"
      if [[ -n "$__pattern_prefix" ]]; then __prefix_base="\${__pattern_prefix##*/}"; fi
      [[ "$__prefix_base" == .* ]] && __prefix_targets_hidden=1
      if [[ "$hidden" == "1" || "$__inside_hidden_path" == "1" || "$__prefix_targets_hidden" == "1" ]]; then shopt -s dotglob; fi

      # Pre-expand file candidates.  When the glob base came from the
      # program's pattern and contains wildcard characters (* or ?),
      # expand it as data with shell globbing. Empty IFS avoids splitting paths;
      # NUL records preserve spaces and newlines without requiring mapfile.
      # Shell expansion respects dotglob on older Bash versions as well.
      # Otherwise append * to treat it as a prefix.
      # Only * and ? are wildcard syntax; escape brackets, backslashes, and
      # extended-glob operators so other pattern characters stay literal.
      local -a __candidates=()
      if [[ "$__from_pattern" == "1" && "$__glob_current" == *[\*\?]* ]]; then
        local __pathname_glob="" __glob_char __glob_index
        for ((__glob_index=0; __glob_index<\${#__glob_current}; __glob_index++)); do
          __glob_char="\${__glob_current:__glob_index:1}"
          case "$__glob_char" in
            '['|']'|'\\'|'('|')'|'|'|'+'|'@'|'!')
              __pathname_glob+="\\\\$__glob_char" ;;
            *) __pathname_glob+="$__glob_char" ;;
          esac
        done
        local __glob_dir="\${__pathname_glob%/*}"
        [[ "$__glob_dir" == "$__pathname_glob" ]] && __glob_dir="."
        local __navigation_dir="" __basename_glob="\${__pathname_glob##*/}"
        # Once an offered directory is entered, keep the basename filter but
        # enumerate there. Only descendants of matching pattern bases qualify.
        if [[ "$type" != "directory" && "$__pattern_prefix" == */* ]]; then
          local __typed_dir="\${__pattern_prefix%/*}" __base_dir __norm_base __norm_dir __base_prefix
          if [[ -d "$__typed_dir" ]]; then
            __norm_dir="\${__typed_dir#./}"; __norm_dir="\${__norm_dir%/}"
            while IFS= read -r -d '' __base_dir; do
              [[ -d "$__base_dir" ]] || continue
              __norm_base="\${__base_dir#./}"; __norm_base="\${__norm_base%/}"
              __base_prefix="$__norm_base/"
              if [[ "$__norm_base" == . && "$__norm_dir" != /* && "$__norm_dir" != . ]] ||
                  [ "\${__norm_dir:0:\${#__base_prefix}}" = "$__base_prefix" ]; then
                __navigation_dir="$__typed_dir"
                break
              fi
            done < <(IFS=; printf '%s\\0' $__glob_dir)
          fi
        fi
        local __candidate
        while IFS= read -r -d '' __candidate; do
          if [[ -e "$__candidate" || -L "$__candidate" ]]; then
            [[ -d "$__candidate" ]] && __candidate="\${__candidate%/}"
            __candidates+=("$__candidate")
          fi
        done < <(
          IFS=
          if [[ -n "$__navigation_dir" ]]; then
            printf '%s\\0' "$__navigation_dir"/$__basename_glob
          else
            printf '%s\\0' $__pathname_glob
          fi
        )
        # For file/any modes, also include directories from the base
        # directory for navigation even when the glob itself does not
        # match directory names.  Skip this for directory mode so that
        # the pattern's basename filter is respected.
        if [[ "$type" != "directory" ]]; then
          local __d
          local __directory_pattern="$__glob_dir/*/"
          while IFS= read -r -d '' __d; do
            [[ -d "$__d" ]] || continue
            __d="\${__d%/}"
            __candidates+=("$__d")
          done < <(
            IFS=
            if [[ -n "$__navigation_dir" ]]; then
              printf '%s\\0' "$__navigation_dir"/*/
            else
              printf '%s\\0' $__directory_pattern
            fi
          )
        fi
      else
        __candidates=("$__glob_current"*)
        # Remove no-match sentinel (bash returns the literal pattern).
        # Also check -L for dangling symlinks which are valid candidates.
        if [[ \${#__candidates[@]} -eq 1 && ! -e "\${__candidates[0]}" && ! -L "\${__candidates[0]}" ]]; then
          __candidates=()
        fi
      fi

      if (( __filter_pattern )); then
        local __nocasematch_was_set=0
        shopt -q nocasematch && __nocasematch_was_set=1
        if shopt -q nocaseglob; then shopt -s nocasematch; else shopt -u nocasematch; fi
        local -a __filtered_candidates=()
        for __candidate in "\${__candidates[@]}"; do
          if [[ "\${__candidate#./}" == "\${__pattern_prefix#./}"* ]]; then
            if [[ "$__pattern_prefix" == ./* && "$__candidate" != ./* ]]; then
              __candidate="./$__candidate"
            elif [[ "$__pattern_prefix" != ./* ]]; then
              __candidate="\${__candidate#./}"
            fi
            __filtered_candidates+=("$__candidate")
          fi
        done
        if (( __nocasematch_was_set )); then shopt -s nocasematch; else shopt -u nocasematch; fi
        __candidates=("\${__filtered_candidates[@]}")
      fi

      # Generate file completions based on type
      case "$type" in
        file)
          # Complete files and directories (directories for navigation)
          if [[ -n "$extensions" ]]; then
            # Files with extension filtering + directories
            local ext_pattern="\${extensions//,/|}"
            ext_pattern='\\.('"$ext_pattern"')$'
            for item in "\${__candidates[@]}"; do
              if [[ -d "$item" ]]; then
                COMPREPLY+=("$item/")
              elif [[ -f "$item" && "$item" =~ $ext_pattern ]]; then
                COMPREPLY+=("$item")
              fi
            done
          else
            # Complete files and directories for navigation
            for item in "\${__candidates[@]}"; do
              if [[ -d "$item" ]]; then
                COMPREPLY+=("$item/")
              elif [[ -f "$item" ]]; then
                COMPREPLY+=("$item")
              fi
            done
          fi
          ;;
        directory)
          # Complete directories only
          for dir in "\${__candidates[@]}"; do
            [[ -d "$dir" ]] && COMPREPLY+=("$dir/")
          done
          ;;
        any)
          # Complete both files and directories
          if [[ -n "$extensions" ]]; then
            # Files with extension filtering + directories
            # Files with extension filtering
            local ext_pattern="\${extensions//,/|}"
            ext_pattern='\\.('"$ext_pattern"')$'
            for item in "\${__candidates[@]}"; do
              if [[ -d "$item" ]]; then
                COMPREPLY+=("$item/")
              elif [[ ( -e "$item" || -L "$item" ) && "$item" =~ $ext_pattern ]]; then
                COMPREPLY+=("$item")
              fi
            done
          else
            # Complete files and directories, add slash to directories
            for item in "\${__candidates[@]}"; do
              if [[ -d "$item" ]]; then
                COMPREPLY+=("$item/")
              # Use -e || -L to include non-regular files (sockets, FIFOs, dangling symlinks)
              elif [[ -e "$item" || -L "$item" ]]; then
                COMPREPLY+=("$item")
              fi
            done
          fi
          ;;
      esac

      # Restore tilde prefix in completion results
      if (( __filter_pattern )); then
        __tilde_prefix="$__pattern_tilde_prefix"
        __tilde_expanded="$__pattern_tilde_expanded"
      fi
      if [[ -n "$__tilde_prefix" &&
            ( -z "$__quote" || $__file_quote_offset -gt 0 ) ]]; then
        local __i
        for __i in "\${!COMPREPLY[@]}"; do
          COMPREPLY[\$__i]="\${COMPREPLY[\$__i]/#\$__tilde_expanded/\$__tilde_prefix}"
        done
      fi

      # Restore glob/shell options
      # Restore GLOBIGNORE before dotglob because assigning GLOBIGNORE
      # implicitly enables dotglob in Bash
      if [[ "$__globignore_was_set" == "1" ]]; then GLOBIGNORE="$__saved_globignore"; fi
      if [[ "$__dotglob_was_set" == "0" ]]; then shopt -u dotglob; else shopt -s dotglob; fi
      if [[ "$__failglob_was_set" == "1" ]]; then shopt -s failglob; fi
      if [[ "$__noglob_was_set" == "1" ]]; then set -f; fi

      # Readline appends directory separators when it receives the full path.
      # Midword quotes still need ours because replies omit the typed prefix.
      if [[ -n "$__quote" && $__file_quote_offset -eq 0 ]]; then
        local __reply_index
        for ((__reply_index=__reply_start; __reply_index<\${#COMPREPLY[@]}; __reply_index++)); do
          COMPREPLY[__reply_index]="\${COMPREPLY[__reply_index]%/}"
        done
      fi

      # Readline replaces only the text after an open quote.  Remove the
      # already typed prefix so it is not inserted a second time.
      # Joined replies are trimmed once against __remove after restoring option=.
      if [[ -n "$__quote" && $__file_quote_offset -gt 0 && -z "$__reply_prefix" ]]; then
        local __quote_prefix="\${__file_current:0:__file_quote_offset}"
        local __reply_index
        for ((__reply_index=__reply_start; __reply_index<\${#COMPREPLY[@]}; __reply_index++)); do
          COMPREPLY[__reply_index]="\${COMPREPLY[__reply_index]#"$__quote_prefix"}"
        done
      fi

      # Readline expands a leading tilde in a returned filename even when the
      # user did not type one.  Keep such local paths explicitly relative.
      if [[ ( "$__raw_file_current" != "~"* || $__file_tilde_quoted == 1 ) && -z "$__tilde_prefix" ]]; then
        local __reply_index
        for ((__reply_index=__reply_start; __reply_index<\${#COMPREPLY[@]}; __reply_index++)); do
          if [[ "\${COMPREPLY[__reply_index]}" =~ $__tilde_glob_pattern ]]; then
            COMPREPLY[__reply_index]="./\${COMPREPLY[__reply_index]}"
          fi
        done
      fi

      # Bash 5.3 leaves substitutions unescaped inside an open double quote.
      # Earlier versions already escape them during filename processing.
      if [[ "$__quote" == '"' &&
            ( \${BASH_VERSINFO[0]} -gt 5 ||
              ( \${BASH_VERSINFO[0]} -eq 5 && \${BASH_VERSINFO[1]} -ge 3 ) ) &&
            $(type -t compopt) == builtin ]]; then
        local __escaped_reply __escape_index __reply_index
        for ((__reply_index=__reply_start; __reply_index<\${#COMPREPLY[@]}; __reply_index++)); do
          __escaped_reply=""
          for ((__escape_index=0; __escape_index<\${#COMPREPLY[__reply_index]}; __escape_index++)); do
            __char="\${COMPREPLY[__reply_index]:__escape_index:1}"
            __next="\${COMPREPLY[__reply_index]:__escape_index+1:1}"
            if [[ "$__char" == '\\' &&
                  ( "$__next" == '$' || "$__next" == '\`' ) ]]; then
              __escaped_reply+="\\\\$__char"
            elif [[ "$__char" == '$' || "$__char" == '\`' ]]; then
              __escaped_reply+="\\\\$__char"
            else
              __escaped_reply+="$__char"
            fi
          done
          COMPREPLY[__reply_index]="$__escaped_reply"
        done
      fi

      # Filter out hidden files unless requested
      if [[ "$hidden" != "1" && "$__inside_hidden_path" == "0" && "$__prefix_targets_hidden" == "0" ]]; then
        local filtered=()
        local __name
        for item in "\${COMPREPLY[@]}"; do
          __name="\${item%/}"; __name="\${__name##*/}"
          if [[ "$__name" != .* ]]; then
            filtered+=("$item")
          fi
        done
        COMPREPLY=("\${filtered[@]}")
      fi
      if [[ \${#COMPREPLY[@]} -gt $__reply_start ]]; then __file_mode=1; fi
    else
      # Regular literal completion
      COMPREPLY+=("$line")
    fi
    for __word in "\${COMPREPLY[@]}"; do
      __replies+=("$__reply_prefix$__word")
    done
  done
  COMPREPLY=()
  for __word in "\${__replies[@]}"; do
    if [[ "\${__word:0:\${#__remove}}" == "$__remove" ]]; then
      COMPREPLY+=("\${__word:\${#__remove}}")
    fi
  done
  if (( \${#COMPREPLY[@]} > 1 )); then
    # Sort shell-escaped keys, not filenames: each key occupies one line even
    # when a candidate contains tabs or newlines. Keep the first occurrence's
    # index, then restore the original order without evaluating escaped data.
    # This works without associative arrays or NUL-aware sort on Bash 3.2.
    local -a __unique_replies=()
    local __index __key __last_key=""
    while IFS= read -r __index; do
      __unique_replies+=("\${COMPREPLY[__index]}")
    done < <(
      for ((__index=0; __index<\${#COMPREPLY[@]}; __index++)); do
        printf '%q\\t%d\\n' "\${COMPREPLY[__index]}" "$__index"
      done |
        LC_ALL=C sort -t $'\\t' -k1,1 -k2,2n |
        {
          while IFS=$'\\t' read -r __key __index; do
            if [ "$__key" != "$__last_key" ]; then
              printf '%s\\n' "$__index"
              __last_key="$__key"
            fi
          done
        } | LC_ALL=C sort -n
    )
    COMPREPLY=("\${__unique_replies[@]}")
  fi
  if [[ $__file_mode == 1 && $(type -t compopt) == builtin ]]; then
    compopt -o filenames 2>/dev/null || true
  fi
}

# Bash 3.2 has no compopt: use filename quoting for all candidates there.
if [[ $(type -t compopt) == builtin ]]; then
  complete -F _${programName} -- ${programName}
else
  complete -o filenames -F _${programName} -- ${programName}
fi
    `;
  },
  *encodeSuggestions(suggestions: readonly Suggestion[]): Iterable<string> {
    let i = 0;
    for (const suggestion of suggestions) {
      if (i > 0) yield "\n";
      const joined = getJoinedFileSuggestion(suggestion);
      if (joined !== undefined) {
        if (joined.literal && suggestion.kind === "literal") {
          yield encodeBashLiteral(suggestion.text);
          yield "\n";
        }
        for (const [index, { prefix, file }] of joined.files.entries()) {
          if (index > 0) yield "\n";
          yield `__JOINED_FILE__:${encodePattern(prefix)}:${file.type}:${
            encodeExtensions(file.extensions)
          }:${encodePattern(sanitizeForTransport(file.pattern ?? ""))}:${
            file.includeHidden ? "1" : "0"
          }`;
        }
      } else if (suggestion.kind === "literal") {
        yield encodeBashLiteral(suggestion.text);
      } else {
        // Emit special marker for native file completion
        const extensions = encodeExtensions(suggestion.extensions);
        const hidden = suggestion.includeHidden ? "1" : "0";
        const pattern = encodePattern(suggestion.pattern ?? "");
        yield `__FILE__:${suggestion.type}:${extensions}:${pattern}:${hidden}`;
      }
      i++;
    }
  },
};

/**
 * The Zsh shell completion generator.
 * @since 0.6.0
 */
export const zsh: ShellCompletion = {
  name: "zsh",
  generateScript(programName: string, args: readonly string[] = []): string {
    validateProgramName(programName);
    const escapedArgs = args.map((arg) => `'${arg.replace(/'/g, "'\\''")}'`)
      .join(" ");
    return `#compdef ${programName}
function _${programName.replace(/[^a-zA-Z0-9]/g, "_")} () {
  local current="\$words[CURRENT]"
  local -a prev
  # Extract previous arguments, skipping empty ones
  prev=()
  local i
  for (( i=2; i < CURRENT; i++ )); do
    if [[ -n "\$words[i]" ]]; then
      prev+=("\$words[i]")
    fi
  done

  # Call the completion function and capture output
  local output
  if (( \${#prev[@]} == 0 )); then
    output=\$(${programName} ${escapedArgs} "\$current" 2>/dev/null)
  else
    output=\$(${programName} ${escapedArgs} "\${prev[@]}" "\$current" 2>/dev/null)
  fi

  # Split output into lines and process each line
  local -a completions descriptions
  local line value desc
  local has_file_completion=0

  while IFS= read -r line; do
    if [[ -n "\$line" ]]; then
      # Split by null character - first part is value, second is description
      value=\${line%%\$'\\0'*}
      desc=\${line#*\$'\\0'}
      desc=\${desc%%\$'\\0'*}

      if [[ "\$value" == __FILE__:* ]]; then
        # Parse file completion directive: __FILE__:type:extensions:pattern:hidden
        local type extensions pattern hidden
        IFS=':' read -r _ type extensions pattern hidden <<< "\$value"
        pattern="\${pattern//%3A/:}"; pattern="\${pattern//%25/%}"
        has_file_completion=1

        # Native completion helpers expect normal zsh glob grouping even if
        # the caller enabled SH_GLOB in their shell options.
        local __was_sh_glob=0
        [[ -o sh_glob ]] && __was_sh_glob=1
        unsetopt sh_glob

        # Enable glob_dots when hidden files are requested so that
        # _files and _directories include dot-prefixed entries
        local __was_glob_dots=0
        [[ -o glob_dots ]] && __was_glob_dots=1
        if [[ "\$hidden" == "1" ]]; then setopt glob_dots; fi

        # When a pattern is specified, override PREFIX so that _files and
        # _directories enumerate the pattern's directory instead of the
        # current word.  If the user has already typed beyond the pattern,
        # keep PREFIX unchanged for incremental narrowing.
        local __saved_prefix="\$PREFIX"
        if [[ -n "\$pattern" ]]; then
          # Normalize leading ./ so that ./src/ma matches pattern src/
          local __norm_prefix="\${PREFIX#./}"
          local __norm_pattern="\${pattern#./}"
          local __compare_pattern="\$__norm_pattern"
          if [[ "\$__compare_pattern" == *[\*\?]* ]]; then
            __compare_pattern="\${__compare_pattern%%[\*\?]*}"
            [[ "\$__compare_pattern" == */* ]] && __compare_pattern="\${__compare_pattern%/*}/" || __compare_pattern=""
          fi
          if [[ ( -n "\$__compare_pattern" || -n "\$__norm_prefix" ) && \${#__norm_prefix} -ge \${#__compare_pattern} && "\${__norm_prefix[1,\${#__compare_pattern}]}" == "\$__compare_pattern" && "\$PREFIX" != "\$pattern" ]]; then
            # User typed an equivalent or extended form — keep PREFIX
            true
          else
            PREFIX="\$pattern"
          fi
        fi

        local ext_pattern=""
        if [[ -n "\$extensions" ]]; then
          if [[ "\$extensions" == *,* ]]; then
            ext_pattern="*.(\${extensions//,/|})"
          else
            ext_pattern="*.\$extensions"
          fi
        fi
        # Use zsh's native file completion
        case "\$type" in
          file)
            if [[ -n "\$ext_pattern" ]]; then
              # Route filtered files through zsh's standard files/directories
              # tags so files-tag styles and tag-order still apply, while
              # avoiding _files' all-files fallback for extension-filtered
              # matches.
              local file_pattern="\${ext_pattern}(#q-.)"
              _wanted files expl file _path_files -g "\${file_pattern}"
              _wanted directories expl directory _path_files -/
            else
              _files
            fi
            ;;
          directory)
            _directories
            ;;
          any)
            if [[ -n "\$ext_pattern" ]]; then
              local file_pattern="\${ext_pattern}(#q^-/)"
              _wanted files expl file _path_files -g "\${file_pattern}"
              _wanted directories expl directory _path_files -/
            else
              _files
            fi
            ;;
        esac

        # Restore PREFIX and glob_dots to their previous state
        PREFIX="\$__saved_prefix"
        if [[ "\$__was_sh_glob" == "1" ]]; then setopt sh_glob; else unsetopt sh_glob; fi
        if [[ "\$__was_glob_dots" == "1" ]]; then setopt glob_dots; else unsetopt glob_dots; fi
      else
        # Regular literal completion
        if [[ -n "\$value" ]]; then
          completions+=("\$value")
          descriptions+=("\$desc")
        fi
      fi
    fi
  done <<< "\$output"

  # Add literal completions with descriptions if we have any
  if (( \${#completions[@]} > 0 )); then
    # Prepare completion with descriptions for _describe
    local -a matches
    local -i i
    for (( i=1; i <= \${#completions[@]}; i++ )); do
      if [[ -n "\${descriptions[i]}" ]]; then
        matches+=("\${completions[i]}:\${descriptions[i]}")
      else
        matches+=("\${completions[i]}")
      fi
    done
    _describe 'commands' matches
  fi
}

if (( $+functions[compdef] )); then
  compdef _${programName.replace(/[^a-zA-Z0-9]/g, "_")} ${programName}
fi
    `;
  },
  *encodeSuggestions(suggestions: readonly Suggestion[]): Iterable<string> {
    for (const suggestion of suggestions) {
      if (suggestion.kind === "literal") {
        const description = suggestion.description == null
          ? ""
          : sanitizeForTransport(
            formatMessage(suggestion.description, { colors: false }),
          );
        yield `${sanitizeForTransport(suggestion.text)}\0${description}\0`;
      } else {
        // Emit special marker for native file completion
        const extensions = encodeExtensions(suggestion.extensions);
        const hidden = suggestion.includeHidden ? "1" : "0";
        const description = suggestion.description == null
          ? ""
          : sanitizeForTransport(
            formatMessage(suggestion.description, { colors: false }),
          );
        const pattern = encodePattern(suggestion.pattern ?? "");
        yield `__FILE__:${suggestion.type}:${extensions}:${pattern}:${hidden}\0${description}\0`;
      }
    }
  },
};

/**
 * The fish shell completion generator.
 * @since 0.6.0
 */
export const fish: ShellCompletion = {
  name: "fish",
  generateScript(programName: string, args: readonly string[] = []): string {
    validateProgramName(programName);
    const escapedArgs = args.map((arg) => `'${arg.replace(/'/g, "\\'")}'`)
      .join(" ");
    const functionName = `__${
      programName.replace(/[^a-zA-Z0-9]/g, "_")
    }_complete`;
    return `
function ${functionName}
    set -l tokens (commandline -poc)
    set -l current (commandline -ct)

    # commandline -poc decodes previous tokens, but commandline -ct returns
    # the current token as typed.  Decode its quotes and escapes as well.
    # Keep the token as typed if decoding fails or yields a newline or tab,
    # which completion output cannot carry.
    set -l __raw_current "$current"
    set -l __decoded (string unescape -- "$current")
    or begin
        # string unescape rejects an unfinished trailing backslash.  fish
        # keeps it literally inside single quotes, which also keep a " as
        # is, and otherwise waits for the character it escapes.
        set -l __prefix (string replace -r '\\\\\\\\$' '' -- "$current")
        set -l __probe (string unescape -- "$__prefix\\"")
        set -l __plain (string unescape -- "$__prefix")
        if test "$__probe" = "$__plain\\""
            set __decoded (string unescape -- "$current\\\\")
        else
            set __decoded (string unescape -- "$__prefix")
        end
    end
    and test (count $__decoded) -eq 1
    and not string match -qr '\\t' -- "$__decoded"
    and set current "$__decoded"

    # Extract previous arguments (skip the command name)
    set -l prev
    set -l count (count $tokens)
    if test $count -gt 1
        set prev $tokens[2..$count]
    end

    # Call completion command and capture output
${
      escapedArgs
        ? `    set -l output (${programName} ${escapedArgs} $prev $current 2>/dev/null)\n`
        : `    set -l output (${programName} $prev $current 2>/dev/null)\n`
    }
    # Process each line of output
    for line in $output
        if string match -q '__FILE__:*' -- $line
            # Parse file completion directive: __FILE__:type:extensions:pattern:hidden
            set -l directive (string split \\t -- $line)[1]
            set -l parts (string split ':' -- $directive)
            set -l type $parts[2]
            set -l extensions $parts[3]
            set -l pattern (string replace -a '%25' '%' -- (string replace -a '%3A' ':' -- $parts[4]))
            set -l hidden $parts[5]

            # path() echoes the current word as its pattern.  When that word
            # was quoted or escaped, treat the echo as the typed word rather
            # than as a pattern from the program.
            if test "$current" != "$__raw_current"; and test "$pattern" = "$current"
                set pattern ""
            end

            # When a pattern is specified, use it as the glob base instead
            # of the current word.  If the user has already typed beyond the
            # pattern (e.g., pattern="src/" and current="src/ma"), keep the
            # current word for incremental narrowing.
            set -l glob_base $current
            set -l __tilde_prefix ""
            set -l __from_pattern 0
            if test -n "$pattern"
                # Normalize leading ./ so that ./src/ma matches pattern src/
                set -l __norm_current (string replace -r '^\\./' '' -- "$current")
                set -l __norm_pattern (string replace -r '^\\./' '' -- "$pattern")
                # For wildcard patterns, compare only the directory prefix.
                # Use a regex: fish wildcards have no character classes.
                # Only the basename can hold wildcards; a ? or * in a
                # directory name such as What?/ is literal.
                set -l __compare_pattern "$__norm_pattern"
                if string match -qr '[*?][^/]*$' -- "$__compare_pattern"
                    set __compare_pattern (string replace -r '[^/]*$' '' -- "$__compare_pattern")
                end
                set -l __cp_len (string length -- "$__compare_pattern")
                set -l __nc_len (string length -- "$__norm_current")
                if begin; test -n "$__compare_pattern"; or test -n "$__norm_current"; end
                    and test $__nc_len -ge $__cp_len
                    and test (string sub -l $__cp_len -- "$__norm_current") = "$__compare_pattern"
                    and test "$current" != "$pattern"
                    set glob_base $current
                else
                    set glob_base $pattern
                    set __from_pattern 1
                end
            end

            # Expand tilde prefix for globbing — fish does not expand ~
            # inside variable substitutions, so replace it with $HOME.  Like
            # fish itself, keep a quoted or escaped tilde in the word literal.
            if test $__from_pattern -eq 1; or string match -q '~*' -- "$__raw_current"
                if string match -q '~/*' -- "$glob_base"
                    set __tilde_prefix "~"
                    set glob_base (string replace -r '^~' "$HOME" -- "$glob_base")
                else if string match -q '~' -- "$glob_base"
                    set __tilde_prefix "~"
                    set glob_base "$HOME/"
                end
            end

            # If the glob base is a directory without a trailing slash,
            # append one so that the glob enumerates its contents
            if test -d "$glob_base"; and not string match -q '*/' -- "$glob_base"
                set glob_base "$glob_base/"
            end

            # Pre-expand file candidates.  When the glob base came from
            # the program's pattern and its basename contains * or ?, use
            # it as the complete glob expression.  Otherwise append * as a
            # prefix, so a literal ? in a directory name such as What?/
            # still lists that directory.  A pattern equal to the current
            # word is the typed text echoed back (as path() does), so its
            # ? and * are literal characters, not wildcards.
            # Note: [ is NOT treated as a glob because it commonly
            # appears in literal filenames like [draft] or foo[1].txt.
            set -l __has_glob 0
            if test $__from_pattern -eq 1
                and string match -qr '[*?][^/]*$' -- "$glob_base"
                and test "$pattern" != "$current"
                set __has_glob 1
            end
            set -l __candidates
            if test $__has_glob -eq 1
                # Safe glob expansion without eval: split the pattern into
                # a directory prefix and a basename filter, list the
                # directory, then match basenames against a regex built
                # from the filter.  The prefix keeps one empty element for
                # bare patterns so that $__glob_prefix* still expands.
                set -l __glob_prefix ""
                if string match -q '*/*' -- "$glob_base"
                    set __glob_prefix (string replace -r '[^/]*$' '' -- "$glob_base")
                end
                set -l __glob_filter (string replace -r '.*/' '' -- "$glob_base")
                # Translate the filter into an anchored regex: * and ? are
                # wildcards and every other character is literal.  Fish's
                # own wildcards cannot be used here because ? is literal
                # when the qmark-noglob feature is enabled (fish 4 default).
                set -l __glob_regex '^'
                for __ch in (string split '' -- "$__glob_filter")
                    if test "$__ch" = '*'
                        set __glob_regex "$__glob_regex.*"
                    else if test "$__ch" = '?'
                        set __glob_regex "$__glob_regex."
                    else
                        set __glob_regex "$__glob_regex"(string escape --style=regex -- "$__ch")
                    end
                end
                set __glob_regex "$__glob_regex"'$'
                # Match files by the glob filter.  Fish's * does not match
                # dotfiles, so also scan .* when the filter targets them or
                # hidden files are requested.
                set -l __entries $__glob_prefix*
                if test "$hidden" = "1"; or string match -q '.*' -- "$__glob_filter"
                    set -a __entries $__glob_prefix.*
                end
                for __item in $__entries
                    if test -e "$__item"
                        set -l __bn (string replace -r '.*/' '' -- "$__item")
                        if contains -- "$__bn" . ..
                            continue
                        end
                        if string match -qr -- "$__glob_regex" "$__bn"
                            set -a __candidates "$__item"
                        end
                    end
                end
                # For file/any modes, also include directories for navigation.
                # Skip for directory mode so the pattern filter is respected.
                # Directories the filter already matched are not repeated.
                if test "$type" != "directory"
                    set -l __nav_dirs $__glob_prefix*/
                    if test "$hidden" = "1"
                        set -a __nav_dirs $__glob_prefix.*/
                    end
                    for __item in $__nav_dirs
                        set __item (string replace -r '/$' '' -- "$__item")
                        set -l __bn (string replace -r '.*/' '' -- "$__item")
                        if contains -- "$__bn" . ..
                            continue
                        end
                        if test -d "$__item"
                            and not string match -qr -- "$__glob_regex" "$__bn"
                            set -a __candidates "$__item"
                        end
                    end
                end
            else
                set __candidates $glob_base*
            end

            # Generate file completions based on type
            set -l items
            switch $type
                case file
                    # Complete files and directories (directories for navigation)
                    for item in $__candidates
                        if test -d $item
                            set -a items $item/
                        else if test -f $item
                            set -a items $item
                        end
                    end
                    # Fish's * glob does not match dotfiles; add them
                    # explicitly when the basename is empty (i.e., $glob_base
                    # is "" or ends with "/"), because only then are * and
                    # .* complementary.  When a non-empty basename is present
                    # (e.g., "foo"), foo* already covers foo.txt, so foo.*
                    # would just produce duplicates.
                    if test "$hidden" = "1" -a $__has_glob -eq 0
                        if test -z "$glob_base"; or string match -q '*/' -- "$glob_base"
                            for item in $glob_base.*
                                if test -d $item
                                    set -a items $item/
                                else if test -f $item
                                    set -a items $item
                                end
                            end
                        end
                    end
                case directory
                    # Complete directories only
                    for item in $__candidates
                        if test -d $item
                            set -a items $item/
                        end
                    end
                    if test "$hidden" = "1" -a $__has_glob -eq 0
                        if test -z "$glob_base"; or string match -q '*/' -- "$glob_base"
                            for item in $glob_base.*
                                if test -d $item
                                    set -a items $item/
                                end
                            end
                        end
                    end
                case any
                    # Complete both files and directories
                    for item in $__candidates
                        if test -d $item
                            set -a items $item/
                        else if test -f $item
                            set -a items $item
                        end
                    end
                    if test "$hidden" = "1" -a $__has_glob -eq 0
                        if test -z "$glob_base"; or string match -q '*/' -- "$glob_base"
                            for item in $glob_base.*
                                if test -d $item
                                    set -a items $item/
                                else if test -f $item
                                    set -a items $item
                                end
                            end
                        end
                    end
            end

            # Filter by extensions if specified
            if test -n "$extensions" -a "$type" != directory
                set -l filtered
                set -l ext_list (string replace -r '^\\.' '' -- (string split ',' -- $extensions))
                for item in $items
                    # Skip directories, they don't have extensions
                    if string match -q '*/' -- $item
                        set -a filtered $item
                        continue
                    end
                    # Check if file matches any extension
                    for ext in $ext_list
                        if string match -q "*.$ext" -- $item
                            set -a filtered $item
                            break
                        end
                    end
                end
                set items $filtered
            end

            # Filter out hidden files unless requested.
            # Check the basename of glob_base so that patterns like
            # "src/.e" correctly target hidden entries.
            set -l __glob_basename (string replace -r '.*/(.*)' '$1' -- $glob_base)
            if test "$hidden" != "1" -a (string sub -l 1 -- $__glob_basename) != "."
                set -l filtered
                for item in $items
                    set -l basename (basename -- "$item")
                    if not string match -q '.*' -- $basename
                        set -a filtered $item
                    end
                end
                set items $filtered
            end

            # Restore tilde prefix in completion results
            if test -n "$__tilde_prefix"
                set -l restored
                for item in $items
                    set -a restored (string replace "$HOME" "~" -- $item)
                end
                set items $restored
            end

            # Output file completions.  Use printf rather than echo, which
            # would take filenames like -n or -e as its own options.
            for item in $items
                printf '%s\\n' $item
            end
        else
            # Regular literal completion - split by tab
            set -l parts (string split \\t -- $line)
            if test (count $parts) -ge 2
                # value\tdescription format
                echo $parts[1]\\t$parts[2]
            else
                # Just value
                echo $line
            end
        end
    end
end

complete -c ${programName} -f -a '(${functionName})'
    `;
  },
  *encodeSuggestions(suggestions: readonly Suggestion[]): Iterable<string> {
    let i = 0;
    for (const suggestion of suggestions) {
      if (i > 0) yield "\n";
      if (suggestion.kind === "literal") {
        const description = suggestion.description == null
          ? ""
          : sanitizeForTransport(
            formatMessage(suggestion.description, { colors: false }),
          );
        // Format: value\tdescription
        yield `${sanitizeForTransport(suggestion.text)}\t${description}`;
      } else {
        // Emit special marker for native file completion
        const extensions = encodeExtensions(suggestion.extensions);
        const hidden = suggestion.includeHidden ? "1" : "0";
        const description = suggestion.description == null
          ? ""
          : sanitizeForTransport(
            formatMessage(suggestion.description, { colors: false }),
          );
        const pattern = encodePattern(suggestion.pattern ?? "");
        yield `__FILE__:${suggestion.type}:${extensions}:${pattern}:${hidden}\t${description}`;
      }
      i++;
    }
  },
};

/**
 * Quotes a string as a Nushell string literal.  Nushell single-quoted strings
 * have no escape sequences, so a value containing an apostrophe is written as
 * a double-quoted string, in which only backslashes and double quotes need
 * escaping.
 */
function quoteNuString(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}

/**
 * The Nushell completion generator.
 * @since 0.6.0
 */
export const nu: ShellCompletion = {
  name: "nu",
  generateScript(programName: string, args: readonly string[] = []): string {
    validateProgramName(programName);
    const escapedArgs = args.map(quoteNuString).join(" ");
    // Replace spaces and special chars with hyphens for function name
    const safeName = programName.replace(/[^a-zA-Z0-9]+/g, "-");
    const functionName = `nu-complete-${safeName}`;
    return `
# Helper to split a command line into the arguments Nushell would pass to
# an external command.  Words are found the way Nushell's lexer finds them
# (quotes and raw strings may contain whitespace), then each word is decoded
# like an external argument.  A final empty argument is added when the line
# ends in unquoted whitespace, for the word about to be completed.
def args-split []: string -> list<string> {
  let WHITESPACES = [" " "\\t" "\\n" "\\r"]
  let QUOTES = ["'" '"' "\`"]

  # Decodes one word.  An unterminated word is the one still being typed,
  # so its open quote is taken as if it were closed.
  let decode = {|word: string, unterminated: bool|
    let hashes = if ($word | str starts-with "r#") {
      $word | str replace -r '(?s)^r(#+).*$' '$1'
    } else {
      ""
    }
    if ($hashes | is-not-empty) {
      let prefix = "r" + $hashes + "'"
      let suffix = "'" + $hashes
      let size = ($hashes | str length)
      if ($word | str starts-with $prefix) and ($word | str ends-with $suffix) and (($word | str length) >= ($size * 2 + 3)) {
        $word | str replace $prefix "" | str replace -r ($suffix + '$') ""
      } else if $unterminated and ($word | str starts-with $prefix) {
        $word | str replace $prefix ""
      } else {
        $word
      }
    } else {
      mut result = ""
      mut quote = ""
      mut quoted = ""
      mut escaped = false
      for char in ($word | split chars) {
        if $quote == "" {
          if ($char in $QUOTES) {
            $quote = $char
            $quoted = ""
          } else {
            $result = $result + $char
          }
        } else if $escaped {
          $quoted = $quoted + $char
          $escaped = false
        } else if $char == $quote {
          let body = $quoted
          $result = $result + (if $quote == '"' {
            try { '"' + $body + '"' | from nuon } catch { $body }
          } else {
            $body
          })
          $quote = ""
        } else {
          $quoted = $quoted + $char
          $escaped = ($quote == '"' and $char == '\\')
        }
      }
      if $quote != "" {
        let body = $quoted
        $result = $result + (if not $unterminated {
          $quote + $body
        } else if $quote == '"' {
          try { '"' + $body + '"' | from nuon } catch { $body }
        } else {
          $body
        })
      }
      $result
    }
  }

  mut words: list<string> = []
  mut word = ""
  mut in_word = false
  mut quote = ""
  mut escaped = false
  mut raw_hashes = ""
  mut raw_pending = ""
  mut prev = ""
  mut trailing_space = false

  for char in ($in | split chars) {
    $trailing_space = false
    if $quote == "#" and $char != "#" and $char != "'" {
      # Not a raw string after all; lex this character normally
      $quote = ""
    }
    if $quote == "r" {
      # Inside a raw string, which ends at ' followed by the same number of #
      if ($raw_pending | is-not-empty) and $char == "#" {
        $raw_pending = $raw_pending + $char
      } else if $char == "'" {
        $raw_pending = $char
      } else {
        $raw_pending = ""
      }
      if $raw_pending == ("'" + $raw_hashes) {
        $quote = ""
        $raw_pending = ""
      }
      $word = $word + $char
    } else if $quote == "#" {
      # Between r# and the opening ' of a raw string
      $word = $word + $char
      if $char == "#" {
        $raw_hashes = $raw_hashes + $char
      } else {
        $quote = "r"
      }
    } else if $quote != "" {
      $word = $word + $char
      if $escaped {
        $escaped = false
      } else if $char == $quote {
        $quote = ""
      } else {
        $escaped = ($quote == '"' and $char == '\\')
      }
    } else if ($char in $WHITESPACES) {
      if $in_word {
        $words = $words | append (do $decode $word false)
        $word = ""
        $in_word = false
      }
      $trailing_space = true
    } else {
      if ($char in $QUOTES) {
        $quote = $char
      } else if $char == "#" and $prev == "r" {
        $quote = "#"
        $raw_hashes = "#"
      }
      $word = $word + $char
      $in_word = true
    }
    $prev = $char
  }
  if $in_word {
    $words = $words | append (do $decode $word ($quote != ""))
  } else if $trailing_space {
    $words = $words | append ""
  }
  $words
}

# Helper to tell whether Nushell would not read a value back verbatim as a
# single argument.  A leading ! is included because the line editor expands
# history (e.g., !!) there.  With --allow-expansion, a leading tilde and n-dot
# path segments (e.g., ...) are allowed to expand.
def needs-quote [--allow-expansion]: string -> bool {
  let value = $in
  let special = ["'" '"' '\`' "#" "(" ")" "[" "]" "{" "}" "|" ";" "&" "$" "*" "?" "<" ">"]
  (
    ($value =~ '\\s')
    or ($special | any {|c| $value | str contains $c })
    or ($value =~ '^(\\+\\+|[-+*/])?=$')
    or ($value | str starts-with '!')
    or ((not $allow_expansion) and (
      ($value | str starts-with '~')
      or ($value | split row -r '[/\\\\]' | any {|s| $s =~ '^\\.{3,}$' })
    ))
  )
}

# Helper to quote a value so that Nushell reads it back verbatim as a
# single argument.  The line editor expands history at a ! that follows
# whitespace even inside quotes, so such a ! is put between two quoted parts,
# right after a quote, where it is left alone.
def quote-arg []: string -> string {
  let value = $in
  if ($value | is-empty) or not ($value | needs-quote) {
    $value
  } else if ($value | str contains "'") {
    '"' + ($value | str replace -a '\\' '\\\\' | str replace -a '"' '\\"' | str replace -ar '(\\s)!' '\${1}"!"') + '"'
  } else {
    "'" + ($value | str replace -ar '(\\s)!' "\${1}'!'") + "'"
  }
}

# Completion command that calls back to the CLI
export def "${functionName}" [context: string] {
  # Split context into the arguments Nushell would pass, including an empty
  # one for a new word when the context ends in unquoted whitespace
  let tokens = $context | args-split

  # Remove the command name (first token) to get arguments
  let args = if ($tokens | length) > 1 {
    $tokens | skip 1
  } else {
    []
  }

  # Ensure at least one argument (empty string) to get completions not script
  let final_args = if ($args | is-empty) {
    ['']
  } else {
    $args
  }

  let output = try {
${
      escapedArgs
        ? `    ^${programName} ${escapedArgs} ...$final_args | complete | get stdout\n`
        : `    ^${programName} ...$final_args | complete | get stdout\n`
    }  } catch {
    ""
  }

  # Process each line of output
  $output | lines | each {|line|
    if ($line | str starts-with '__FILE__:') {
      # Parse file completion directive: __FILE__:type:extensions:pattern:hidden
      let directive = ($line | split row "\t" | first)
      let parts = ($directive | split row ':')
      let type = ($parts | get 1)
      let extensions = ($parts | get 2)
      let pattern = ($parts | get 3 | str replace -a '%3A' ':' | str replace -a '%25' '%')
      let hidden = ($parts | get 4) == '1'

      # Extract prefix from the last argument if it exists
      let prefix = if ($final_args | length) > 0 {
        $final_args | last
      } else {
        ""
      }

      # When a pattern is specified, use it as the glob base instead of
      # the user-typed prefix.  If the user has already typed beyond the
      # pattern (e.g., pattern="src/" and prefix="src/ma"), keep the
      # prefix for incremental narrowing.  Normalize path separators
      # before comparing so that Windows backslashes match forward slashes
      # in the transported pattern.
      let glob_base = if ($pattern | is-not-empty) {
        # Normalize separators and leading ./; downcase only on Windows
        # where filesystems are typically case-insensitive
        let norm_prefix_raw = ($prefix | str replace -a '\\' '/' | str replace -r '^\\./' '')
        let norm_pattern_raw = ($pattern | str replace -a '\\' '/' | str replace -r '^\\./' '')
        let is_win = (($nu.os-info.name | str downcase) == "windows")
        let norm_prefix = (if $is_win { $norm_prefix_raw | str downcase } else { $norm_prefix_raw })
        let norm_pattern = (if $is_win { $norm_pattern_raw | str downcase } else { $norm_pattern_raw })
        # For wildcard patterns, compare only the directory prefix
        let compare_pattern = if ($norm_pattern =~ '[*?]') {
          let before_wild = ($norm_pattern | str replace -r '[*?].*' '')
          if ($before_wild =~ '/') { $before_wild | str replace -r '/[^/]*$' '/' } else { "" }
        } else {
          $norm_pattern
        }
        if (($compare_pattern | is-not-empty) or ($norm_prefix | is-not-empty)) and ($norm_prefix | str starts-with $compare_pattern) and (($norm_prefix | str length) >= ($compare_pattern | str length)) and ($prefix != $pattern) {
          $prefix
        } else {
          $pattern
        }
      } else {
        $prefix
      }

      # If the glob base is a directory without a trailing slash (e.g., "src"),
      # append one so that ls enumerates its contents instead of matching
      # siblings like "src-old".  path expand follows symlinks, so that
      # a symlink to a directory is treated the same way; --no-symlink first
      # resolves .. against the logical $env.PWD as ls does
      let glob_base = if ($glob_base | is-not-empty) and ($glob_base | path expand --no-symlink | path expand | path type) == "dir" and (not ($glob_base | str ends-with "/")) {
        $glob_base + "/"
      } else {
        $glob_base
      }

      # Generate file completions based on type.
      # When the glob base contains wildcard characters, use it as-is;
      # otherwise append * to treat it as a prefix.
      # Note: into glob is required so that ls expands wildcards from a variable
      let has_glob = ($glob_base =~ '[*?]')
      let ls_pattern = if ($glob_base | is-empty) {
        "."
      } else if $has_glob {
        ($glob_base | into glob)
      } else {
        ($glob_base + "*" | into glob)
      }

      # When using a glob pattern, also compute a directory listing pattern
      # so that file/any modes can include directories for navigation
      let glob_dir_pattern = if $has_glob {
        let dir_part = ($glob_base | path dirname)
        let dir = if ($dir_part | is-empty) or ($dir_part == $glob_base) { "." } else { $dir_part }
        ($dir + "/*" | into glob)
      } else {
        null
      }

      # List entries matching a pattern, using ls -a to include hidden
      # files when requested.  ls reports every symlink as type "symlink",
      # so classify each one by its target's type instead (path expand
      # follows symlinks); broken or looping symlinks stay "symlink".
      # Join the name to $env.PWD first so that a leading ~ in an entry
      # name is not expanded to a home directory, and resolve .. against
      # the logical $env.PWD (--no-symlink) before following the symlink
      let list_entries = {|pattern|
        (if $hidden { ls -a $pattern } else { ls $pattern }) | each {|item|
          if $item.type == symlink {
            $item | update type ($env.PWD | path join $item.name | path expand --no-symlink | path expand | path type)
          } else {
            $item
          }
        }
      }

      let items = try {
        match $type {
          "file" => {
            if ($extensions | is-empty) {
              (do $list_entries $ls_pattern) | where type == file or type == dir
            } else {
              let ext_list = ($extensions | split row ',' | each {|e| $e | str replace -r '^\\.' '' })
              let all_items = (do $list_entries $ls_pattern)
              let dirs = $all_items | where type == dir
              let files = $all_items | where type == file | where {|f|
                let ext = ($f.name | path parse | get extension)
                $ext in $ext_list
              }
              $dirs | append $files
            }
          },
          "directory" => {
            (do $list_entries $ls_pattern) | where type == dir
          },
          "any" => {
            if ($extensions | is-empty) {
              do $list_entries $ls_pattern
            } else {
              let ext_list = ($extensions | split row ',' | each {|e| $e | str replace -r '^\\.' '' })
              let all_items = (do $list_entries $ls_pattern)
              let dirs = $all_items | where type == dir
              let files = $all_items | where type == file | where {|f|
                let ext = ($f.name | path parse | get extension)
                $ext in $ext_list
              }
              $dirs | append $files
            }
          }
        }
      } catch {
        []
      }

      # When using a glob pattern, also add directories from the base
      # directory for navigation (file/any modes should list directories
      # even when the glob itself does not match directory names)
      let items = if ($glob_dir_pattern != null) and ($type != "directory") {
        let extra_dirs = try {
          (do $list_entries $glob_dir_pattern) | where type == dir
        } catch {
          []
        }
        $items | append $extra_dirs | uniq-by name
      } else {
        $items
      }

      # Filter out hidden files unless requested.
      # Check the basename of glob_base so that patterns like "src/.e"
      # correctly target hidden entries.
      let glob_basename = ($glob_base | path basename)
      let filtered = if $hidden or ($glob_basename | str starts-with '.') {
        $items
      } else {
        $items | where {|item|
          let basename = ($item.name | path basename)
          not ($basename | str starts-with '.')
        }
      }

      # Extract directory prefix to preserve in completion text
      let dir_prefix = if ($glob_base | is-empty) {
        ""
      } else if ($glob_base | str ends-with "/") {
        $glob_base
      } else {
        let parsed = ($glob_base | path parse)
        if ($parsed.parent | is-empty) { "" } else if ($parsed.parent | str ends-with "/") { $parsed.parent } else { $parsed.parent + "/" }
      }

      # Format file completions, quoting names that Nushell would not read
      # back as a single argument
      $filtered | each {|item|
        let base = if $item.type == dir {
          ($item.name | path basename) + "/"
        } else {
          $item.name | path basename
        }
        let name = $dir_prefix + $base
        # Nushell expands a leading tilde even in a file name, but not after ./
        let spelled = if ($dir_prefix | is-empty) and ($base | str starts-with '~') {
          './' + $base
        } else {
          $name
        }
        # A tilde or n-dot prefix typed by the user is meant to be expanded
        # by Nushell, which quoting would prevent, so expand such a prefix
        # here when the value has to be quoted
        let literal_ndots = ($base | str replace -r '[/\\\\]$' '') =~ '^\\.{3,}$'
        let expandable = ($dir_prefix | str starts-with '~') or ($dir_prefix | split row -r '[/\\\\]' | any {|s| $s =~ '^\\.{3,}$' })
        let value = if not ($literal_ndots or ($spelled | needs-quote --allow-expansion)) {
          $spelled
        } else if $expandable {
          let expanded_prefix = ($dir_prefix | path expand --no-symlink)
          let expanded_prefix = if ($expanded_prefix | str ends-with "/") { $expanded_prefix } else { $expanded_prefix + "/" }
          ($expanded_prefix + $base) | quote-arg
        } else {
          $spelled | quote-arg
        }
        if $value == $name {
          { value: $value }
        } else {
          { value: $value, display_override: $name }
        }
      }
    } else {
      # Regular literal completion - split by tab
      let parts = ($line | split row "\t")
      let record = if ($parts | length) >= 2 {
        # value\\tdescription format
        { value: ($parts | get 0), description: ($parts | get 1) }
      } else if ($parts | length) == 1 and ($parts | get 0 | is-not-empty) {
        # Just value
        { value: ($parts | get 0) }
      } else {
        null
      }
      # Quote values that Nushell would not read back as a single argument,
      # while the menu keeps showing them as they are
      if $record == null {
        null
      } else {
        let value = ($record.value | quote-arg)
        if $value == $record.value {
          $record
        } else {
          $record | upsert value $value | insert display_override $record.value
        }
      }
    }
  } | flatten | compact
}

# Custom completer for external commands
# This function will be called by Nushell's completion system
def --env "${functionName}-external" [] {
  let existing_completer = $env.config.completions.external.completer

  $env.config.completions.external.completer = {|spans|
    # Check if this is for our program
    if ($spans.0 == "${programName}") {
      # Build context string from spans
      let context = $spans | str join ' '
      ${functionName} $context
    } else if ($existing_completer != null) {
      # Delegate to existing completer
      do $existing_completer $spans
    } else {
      # No completions
      null
    }
  }

  $env.config.completions.external.enable = true
}

# Auto-setup: register the completer when this module is imported
${functionName}-external
    `;
  },
  *encodeSuggestions(suggestions: readonly Suggestion[]): Iterable<string> {
    let i = 0;
    for (const suggestion of suggestions) {
      if (i > 0) yield "\n";
      if (suggestion.kind === "literal") {
        const description = suggestion.description == null
          ? ""
          : sanitizeForTransport(
            formatMessage(suggestion.description, { colors: false }),
          );
        // Format: value\tdescription
        yield `${sanitizeForTransport(suggestion.text)}\t${description}`;
      } else {
        // Emit special marker for native file completion
        const extensions = encodeExtensions(suggestion.extensions);
        const hidden = suggestion.includeHidden ? "1" : "0";
        const description = suggestion.description == null
          ? ""
          : sanitizeForTransport(
            formatMessage(suggestion.description, { colors: false }),
          );
        const pattern = encodePattern(suggestion.pattern ?? "");
        yield `__FILE__:${suggestion.type}:${extensions}:${pattern}:${hidden}\t${description}`;
      }
      i++;
    }
  },
};

/**
 * The PowerShell completion generator.
 * @since 0.6.0
 */
export const pwsh: ShellCompletion = {
  name: "pwsh",
  generateScript(programName: string, args: readonly string[] = []): string {
    validateProgramName(programName);
    const escapedArgs = args.map((arg) => `'${arg.replace(/'/g, "''")}'`)
      .join(", ");
    return `
Register-ArgumentCompleter -Native -CommandName ${programName} -ScriptBlock {
    param(\$wordToComplete, \$commandAst, \$cursorPosition)

    # Extract arguments from AST (handles quoted strings properly)
    \$arguments = @()
    \$commandElements = \$commandAst.CommandElements

    # Keep only complete arguments before the cursor.  The current word
    # (including a token ending exactly at the cursor) is appended below.
    for (\$i = 1; \$i -lt \$commandElements.Count; \$i++) {
        \$element = \$commandElements[\$i]
        if (\$element.Extent.EndOffset -ge \$cursorPosition) { break }

        if (\$element -is [System.Management.Automation.Language.StringConstantExpressionAst]) {
            \$arguments += \$element.Value
        } else {
            \$arguments += \$element.Extent.Text
        }
    }

    # Build arguments array for completion command
    \$completionArgs = @()
${
      escapedArgs
        ? `    \$completionArgs += @(${escapedArgs})
`
        : ""
    }    \$completionArgs += \$arguments
    \$completionArgs += \$wordToComplete

    # Call completion command and capture output
    try {
        \$output = & ${programName} \$completionArgs 2>\$null
        if (-not \$output) { return }

        # Parse tab-separated output and create CompletionResult objects
        \$output -split "\`n" | ForEach-Object {
            \$line = \$_.Trim()
            if (-not \$line) { return }

            if (\$line -match '^__FILE__:') {
                # Parse file completion directive: __FILE__:type:extensions:pattern:hidden
                \$directive = (\$line -split "\`t")[0]
                \$parts = \$directive -split ':', 5
                \$type = \$parts[1]
                \$extensions = \$parts[2]
                \$pattern = \$parts[3] -replace '%3A', ':' -replace '%25', '%'
                \$hidden = \$parts[4] -eq '1'

                # When a pattern is specified, use it as the file matching
                # prefix instead of the current word.  If the user has
                # already typed beyond the pattern, keep their input for
                # incremental narrowing.  Normalize path separators before
                # comparing so that Windows backslashes match forward slashes
                # in the transported pattern.
                \$normalizedPattern = if (\$pattern) { \$pattern.Replace('\\', '/') -replace '^\\./','' } else { '' }
                \$normalizedWord = if (\$wordToComplete) { \$wordToComplete.Replace('\\', '/') -replace '^\\./','' } else { '' }
                \$comparison = if (\$IsWindows) { [System.StringComparison]::OrdinalIgnoreCase } else { [System.StringComparison]::Ordinal }
                # For wildcard patterns, compare only the directory prefix
                \$comparePattern = \$normalizedPattern
                if (\$comparePattern -match '[\*\?]') {
                    \$beforeWild = \$comparePattern -replace '[\*\?].*', ''
                    if (\$beforeWild.Contains('/')) {
                        \$comparePattern = \$beforeWild.Substring(0, \$beforeWild.LastIndexOf('/') + 1)
                    } else {
                        \$comparePattern = ''
                    }
                }
                \$prefix = if ((\$comparePattern -or \$normalizedWord) -and \$normalizedWord -and \$normalizedWord.StartsWith(\$comparePattern, \$comparison) -and \$normalizedWord.Length -ge \$comparePattern.Length -and \$wordToComplete -ne \$pattern) {
                    \$wordToComplete
                } elseif (\$pattern) {
                    \$pattern
                } elseif (\$wordToComplete) {
                    \$wordToComplete
                } else { '' }

                # Use -Force to include hidden files when requested, or when
                # the prefix basename targets dotfiles (e.g., src/.e)
                \$prefixBasename = if (\$prefix) { Split-Path -Leaf \$prefix } else { '' }
                \$forceParam = if (\$hidden -or (\$prefixBasename -and \$prefixBasename.StartsWith('.'))) { @{Force = \$true} } else { @{} }

                # If prefix is a directory without trailing slash, append
                # one so Get-ChildItem lists its contents
                if (\$prefix -and (Test-Path -Path \$prefix -PathType Container) -and -not \$prefix.EndsWith('/') -and -not \$prefix.EndsWith('\\')) {
                    \$prefix = \$prefix + '/'
                }

                # Build the glob path — when the prefix contains wildcard
                # characters, use it as-is; otherwise append *
                \$globPath = if (\$prefix -match '[\*\?]') { \$prefix } else { "\${prefix}*" }

                # Get file system items based on type
                \$items = @()
                switch (\$type) {
                    'file' {
                        if (\$extensions) {
                            # Filter by extensions, always include directories
                            \$extList = (\$extensions -split ',') -replace '^\\.',''
                            \$items = Get-ChildItem @forceParam -Path \$globPath -ErrorAction SilentlyContinue |
                                Where-Object {
                                    \$_.PSIsContainer -or ((\$_.Extension -replace '^\\.','' ) -cin \$extList)
                                }
                        } else {
                            \$items = Get-ChildItem @forceParam -Path \$globPath -ErrorAction SilentlyContinue
                        }
                    }
                    'directory' {
                        \$items = Get-ChildItem @forceParam -Directory -Path \$globPath -ErrorAction SilentlyContinue
                    }
                    'any' {
                        if (\$extensions) {
                            # Filter by extensions, always include directories
                            \$extList = (\$extensions -split ',') -replace '^\\.',''
                            \$items = Get-ChildItem @forceParam -Path \$globPath -ErrorAction SilentlyContinue |
                                Where-Object {
                                    \$_.PSIsContainer -or ((\$_.Extension -replace '^\\.','' ) -cin \$extList)
                                }
                        } else {
                            \$items = Get-ChildItem @forceParam -Path \$globPath -ErrorAction SilentlyContinue
                        }
                    }
                }

                # For file/any modes with glob patterns, also add directories
                # from the base directory for navigation
                if (\$prefix -match '[\*\?]' -and \$type -ne 'directory') {
                    \$globDir = Split-Path -Parent \$prefix
                    if (-not \$globDir) { \$globDir = '.' }
                    \$extraDirs = Get-ChildItem @forceParam -Directory -Path "\$globDir/*" -ErrorAction SilentlyContinue
                    if (\$extraDirs) { \$items = @(\$items) + @(\$extraDirs) | Select-Object -Unique }
                }

                # Filter hidden files unless requested or the prefix targets dotfiles
                if (-not \$hidden -and -not (\$prefixBasename -and \$prefixBasename.StartsWith('.'))) {
                    \$items = \$items | Where-Object { -not \$_.Attributes.HasFlag([System.IO.FileAttributes]::Hidden) }
                }

                # Extract directory prefix to preserve in completion text
                \$dirPrefix = if (\$prefix -and (\$prefix.Contains('/') -or \$prefix.Contains('\\'))) {
                    \$slashIdx = [Math]::Max(\$prefix.LastIndexOf('/'), \$prefix.LastIndexOf('\\'))
                    \$prefix.Substring(0, \$slashIdx + 1)
                } else { '' }

                # Create completion results for files
                \$items | ForEach-Object {
                    \$completionText = if (\$_.PSIsContainer) { "\$dirPrefix\$(\$_.Name)/" } else { "\$dirPrefix\$(\$_.Name)" }
                    \$itemType = if (\$_.PSIsContainer) { 'Directory' } else { 'File' }
                    [System.Management.Automation.CompletionResult]::new(
                        \$completionText,
                        \$completionText,
                        'ParameterValue',
                        \$itemType
                    )
                }
            } else {
                # Parse literal completion: text\\tlistItemText\\tdescription
                \$parts = \$line -split "\`t", 3
                \$completionText = \$parts[0]
                \$listItemText = if (\$parts.Length -gt 1 -and \$parts[1]) { \$parts[1] } else { \$completionText }
                \$toolTip = if (\$parts.Length -gt 2 -and \$parts[2]) { \$parts[2] } else { \$completionText }

                [System.Management.Automation.CompletionResult]::new(
                    \$completionText,
                    \$listItemText,
                    'ParameterValue',
                    \$toolTip
                )
            }
        }
    } catch {
        # Silently ignore errors
    }
}
    `;
  },
  *encodeSuggestions(suggestions: readonly Suggestion[]): Iterable<string> {
    let i = 0;
    for (const suggestion of suggestions) {
      if (i > 0) yield "\n";
      if (suggestion.kind === "literal") {
        const description = suggestion.description == null
          ? ""
          : sanitizeForTransport(
            formatMessage(suggestion.description, { colors: false }),
          );
        // Format: text\tlistItemText\tdescription
        const text = sanitizeForTransport(suggestion.text);
        yield `${text}\t${text}\t${description}`;
      } else {
        // Emit special marker for native file completion
        const extensions = encodeExtensions(suggestion.extensions);
        const hidden = suggestion.includeHidden ? "1" : "0";
        const description = suggestion.description == null
          ? ""
          : sanitizeForTransport(
            formatMessage(suggestion.description, { colors: false }),
          );
        const pattern = encodePattern(suggestion.pattern ?? "");
        yield `__FILE__:${suggestion.type}:${extensions}:${pattern}:${hidden}\t[file]\t${description}`;
      }
      i++;
    }
  },
};

// cSpell: ignore: COMPREPLY compdef commandline completername
