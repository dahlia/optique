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

function encodeExtensions(
  extensions: readonly string[] | undefined,
): string {
  return extensions?.map((ext) => ext.replace(/^\./, "")).join(",") ?? "";
}

/**
 * Replaces control characters that would corrupt shell completion protocols.
 * Shell completion formats use tabs as field delimiters and newlines as record
 * delimiters.  Null bytes are used as delimiters in zsh's format.
 * @param description The description string to sanitize.
 * @returns The sanitized description with control characters replaced by spaces.
 * @internal
 */
function sanitizeDescription(description: string): string {
  return description.replace(/[\t\n\r\0]/g, " ");
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
  local current="\${COMP_WORDS[COMP_CWORD]}"
  local prev=("\${COMP_WORDS[@]:1:COMP_CWORD-1}")
  while IFS= read -r line; do
    if [[ "$line" == __FILE__:* ]]; then
      # Parse file completion directive: __FILE__:type:extensions:pattern:hidden
      IFS=':' read -r _ type extensions pattern hidden <<< "$line"
      pattern="\${pattern//%3A/:}"; pattern="\${pattern//%25/%}"

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
      local __glob_current="$current" __tilde_prefix="" __tilde_expanded=""
      if [[ "$current" =~ ^(~[a-zA-Z0-9_.+-]*)(/.*)$ ]]; then
        __tilde_prefix="\${BASH_REMATCH[1]}"
        eval "__tilde_expanded=\$__tilde_prefix" 2>/dev/null || true
        if [[ -n "$__tilde_expanded" && "$__tilde_expanded" != "$__tilde_prefix" ]]; then
          __glob_current="\${__tilde_expanded}\${current#\$__tilde_prefix}"
        else
          __tilde_prefix=""
        fi
      fi

      # When a pattern is specified, use it as the glob base instead of the
      # current word so that completions enumerate the pattern's directory.
      # However, if the user has already typed beyond the pattern (e.g.,
      # pattern="src/" and current="src/ma"), preserve the typed suffix
      # for incremental filtering.
      if [[ -n "$pattern" ]]; then
        # Normalize leading ./ so that ./src/ma matches pattern src/
        local __norm_current="\${current#./}"
        local __norm_pattern="\${pattern#./}"
        if [[ \${#__norm_current} -gt \${#__norm_pattern} && "\${__norm_current:0:\${#__norm_pattern}}" == "$__norm_pattern" ]]; then
          # User has typed beyond the pattern — keep current for narrowing
          true
        else
          # Reset tilde state from the current-word expansion so that a
          # non-tilde pattern is not rewritten through stale tilde state
          __tilde_prefix=""
          __tilde_expanded=""
          __glob_current="$pattern"
          if [[ "$pattern" =~ ^(~[a-zA-Z0-9_.+-]*)(/.*)$ ]]; then
            __tilde_prefix="\${BASH_REMATCH[1]}"
            eval "__tilde_expanded=\$__tilde_prefix" 2>/dev/null || true
            if [[ -n "$__tilde_expanded" && "$__tilde_expanded" != "$__tilde_prefix" ]]; then
              __glob_current="\${__tilde_expanded}\${pattern#\$__tilde_prefix}"
            else
              __tilde_prefix=""
            fi
          fi
        fi
      fi

      # Enable dotglob when hidden files are requested, or when the user
      # is already navigating inside a hidden directory (e.g., ~/.config/nvim/)
      # This runs after tilde expansion so that paths like ~/.config/ are
      # checked against the expanded path, not the literal ~ string.
      local __inside_hidden_path=0
      case "/\${__glob_current%/}/" in
        */.[!.]*/*|*/..?*/*) __inside_hidden_path=1 ;;
      esac
      # Also check if the current prefix explicitly targets hidden entries
      # (e.g., user typed "." or ".e" to complete .env)
      local __prefix_targets_hidden=0
      local __prefix_base="\${__glob_current##*/}"
      [[ "$__prefix_base" == .* ]] && __prefix_targets_hidden=1
      if [[ "$hidden" == "1" || "$__inside_hidden_path" == "1" || "$__prefix_targets_hidden" == "1" ]]; then shopt -s dotglob; fi

      # Generate file completions based on type
      case "$type" in
        file)
          # Complete files and directories (directories for navigation)
          if [[ -n "$extensions" ]]; then
            # Files with extension filtering + directories
            local ext_pattern="\${extensions//,/|}"
            for item in "$__glob_current"*; do
              if [[ -d "$item" ]]; then
                COMPREPLY+=("$item/")
              elif [[ -f "$item" && "$item" =~ \\.($ext_pattern)$ ]]; then
                COMPREPLY+=("$item")
              fi
            done
          else
            # Complete files and directories for navigation
            for item in "$__glob_current"*; do
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
          for dir in "$__glob_current"*; do
            [[ -d "$dir" ]] && COMPREPLY+=("$dir/")
          done
          ;;
        any)
          # Complete both files and directories
          if [[ -n "$extensions" ]]; then
            # Files with extension filtering + directories
            # Files with extension filtering
            local ext_pattern="\${extensions//,/|}"
            for item in "$__glob_current"*; do
              if [[ -d "$item" ]]; then
                COMPREPLY+=("$item/")
              elif [[ ( -e "$item" || -L "$item" ) && "$item" =~ \\.($ext_pattern)$ ]]; then
                COMPREPLY+=("$item")
              fi
            done
          else
            # Complete files and directories, add slash to directories
            for item in "$__glob_current"*; do
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
      if [[ -n "$__tilde_prefix" ]]; then
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

      # Filter out hidden files unless requested
      if [[ "$hidden" != "1" && "$__inside_hidden_path" == "0" && "$__prefix_targets_hidden" == "0" ]]; then
        local filtered=()
        local __name
        for item in "\${COMPREPLY[@]}"; do
          __name="\${item%/}"; __name="\${__name##*/}"
          [[ "$__name" != .* ]] && filtered+=("$item")
        done
        COMPREPLY=("\${filtered[@]}")
      fi
    else
      # Regular literal completion
      COMPREPLY+=("$line")
    fi
  done < <(${programName} ${escapedArgs} "\${prev[@]}" "$current" 2>/dev/null)
}

complete -F _${programName} -- ${programName}
    `;
  },
  *encodeSuggestions(suggestions: readonly Suggestion[]): Iterable<string> {
    let i = 0;
    for (const suggestion of suggestions) {
      if (i > 0) yield "\n";
      if (suggestion.kind === "literal") {
        yield `${suggestion.text}`;
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
    return `
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
          if [[ ! ( \${#__norm_prefix} -gt \${#__norm_pattern} && "\${__norm_prefix[1,\${#__norm_pattern}]}" == "\$__norm_pattern" ) ]]; then
            PREFIX="\$pattern"
          fi
        fi

        # Use zsh's native file completion
        case "\$type" in
          file)
            if [[ -n "\$extensions" ]]; then
              # Complete files with extension filtering + directories for navigation
              local ext_pattern="*.(\$\{extensions//,/|\})"
              _files -g "\$ext_pattern"; _directories
            else
              _files
            fi
            ;;
          directory)
            _directories
            ;;
          any)
            if [[ -n "\$extensions" ]]; then
              # Complete both files and directories, with extension filtering for files
              local ext_pattern="*.(\$\{extensions//,/|\})"
              _files -g "\$ext_pattern"; _directories
            else
              _files
            fi
            ;;
        esac

        # Restore PREFIX and glob_dots to their previous state
        PREFIX="\$__saved_prefix"
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

compdef _${programName.replace(/[^a-zA-Z0-9]/g, "_")} ${programName}
    `;
  },
  *encodeSuggestions(suggestions: readonly Suggestion[]): Iterable<string> {
    for (const suggestion of suggestions) {
      if (suggestion.kind === "literal") {
        const description = suggestion.description == null
          ? ""
          : sanitizeDescription(
            formatMessage(suggestion.description, { colors: false }),
          );
        yield `${suggestion.text}\0${description}\0`;
      } else {
        // Emit special marker for native file completion
        const extensions = encodeExtensions(suggestion.extensions);
        const hidden = suggestion.includeHidden ? "1" : "0";
        const description = suggestion.description == null
          ? ""
          : sanitizeDescription(
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

            # When a pattern is specified, use it as the glob base instead
            # of the current word.  If the user has already typed beyond the
            # pattern (e.g., pattern="src/" and current="src/ma"), keep the
            # current word for incremental narrowing.
            set -l glob_base $current
            set -l __tilde_prefix ""
            if test -n "$pattern"
                # Normalize leading ./ so that ./src/ma matches pattern src/
                set -l __norm_current (string replace -r '^\\./' '' -- "$current")
                set -l __norm_pattern (string replace -r '^\\./' '' -- "$pattern")
                set -l __np_len (string length -- "$__norm_pattern")
                set -l __nc_len (string length -- "$__norm_current")
                if test $__nc_len -gt $__np_len
                    and test (string sub -l $__np_len -- "$__norm_current") = "$__norm_pattern"
                    set glob_base $current
                else
                    set glob_base $pattern
                end
            end

            # Expand tilde prefix for globbing — fish does not expand ~
            # inside variable substitutions, so replace it with $HOME
            if string match -q '~/*' -- "$glob_base"
                set __tilde_prefix "~"
                set glob_base (string replace -r '^~' "$HOME" -- "$glob_base")
            else if string match -q '~' -- "$glob_base"
                set __tilde_prefix "~"
                set glob_base "$HOME"
            end

            # Generate file completions based on type
            set -l items
            switch $type
                case file
                    # Complete files and directories (directories for navigation)
                    for item in $glob_base*
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
                    if test "$hidden" = "1"
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
                    for item in $glob_base*
                        if test -d $item
                            set -a items $item/
                        end
                    end
                    if test "$hidden" = "1"
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
                    for item in $glob_base*
                        if test -d $item
                            set -a items $item/
                        else if test -f $item
                            set -a items $item
                        end
                    end
                    if test "$hidden" = "1"
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
                set -l ext_list (string split ',' -- $extensions)
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
                    set -l basename (basename $item)
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

            # Output file completions
            for item in $items
                echo $item
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
          : sanitizeDescription(
            formatMessage(suggestion.description, { colors: false }),
          );
        // Format: value\tdescription
        yield `${suggestion.text}\t${description}`;
      } else {
        // Emit special marker for native file completion
        const extensions = encodeExtensions(suggestion.extensions);
        const hidden = suggestion.includeHidden ? "1" : "0";
        const description = suggestion.description == null
          ? ""
          : sanitizeDescription(
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
 * The Nushell completion generator.
 * @since 0.6.0
 */
export const nu: ShellCompletion = {
  name: "nu",
  generateScript(programName: string, args: readonly string[] = []): string {
    validateProgramName(programName);
    const escapedArgs = args.map((arg) => `'${arg.replace(/'/g, "''")}'`)
      .join(" ");
    // Replace spaces and special chars with hyphens for function name
    const safeName = programName.replace(/[^a-zA-Z0-9]+/g, "-");
    const functionName = `nu-complete-${safeName}`;
    return `
# Helper to split args respecting quotes and whitespace
def args-split []: string -> list<string> {
  let STATE_NORMAL = 0
  let STATE_IN_SINGLE_QUOTE = 1
  let STATE_IN_DOUBLE_QUOTE = 2
  let STATE_ESCAPE = 3
  let WHITESPACES = [" " "\\t" "\\n" "\\r"]

  mut state = $STATE_NORMAL
  mut current_token = ""
  mut result: list<string> = []
  mut prev_state = $STATE_NORMAL

  for char in ($in | split chars) {
    if $state == $STATE_ESCAPE {
      $current_token = $current_token + $char
      $state = $prev_state
    } else if $char == '\\\\' {
      $prev_state = $state
      $state = $STATE_ESCAPE
    } else if $state == $STATE_NORMAL {
      if $char == "'" {
        $state = $STATE_IN_SINGLE_QUOTE
      } else if $char == '"' {
        $state = $STATE_IN_DOUBLE_QUOTE
      } else if ($char in $WHITESPACES) {
        if ($current_token | is-not-empty) {
          $result = $result | append $current_token
          $current_token = ""
        }
      } else {
        $current_token = $current_token + $char
      }
    } else if $state == $STATE_IN_SINGLE_QUOTE {
      if $char == "'" {
        $state = $STATE_NORMAL
      } else {
        $current_token = $current_token + $char
      }
    } else if $state == $STATE_IN_DOUBLE_QUOTE {
      if $char == '"' {
        $state = $STATE_NORMAL
      } else {
        $current_token = $current_token + $char
      }
    }
  }
  if ($current_token | is-not-empty) {
    $result = $result | append $current_token
  }
  $result
}

# Completion command that calls back to the CLI
export def "${functionName}" [context: string] {
  # Split context into tokens, handling quotes properly
  let tokens = $context | args-split

  # Remove the command name (first token) to get arguments
  let args = if ($tokens | length) > 1 {
    $tokens | skip 1
  } else {
    []
  }

  # If context ends with whitespace, add empty string to represent the new argument
  let args_with_empty = if ($context | str ends-with ' ') {
    $args | append ''
  } else {
    $args
  }

  # Ensure at least one argument (empty string) to get completions not script
  let final_args = if ($args_with_empty | is-empty) {
    ['']
  } else {
    $args_with_empty
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
        # Normalize separators, leading ./, and case so that SRC\ma matches src/
        let norm_prefix = ($prefix | str replace -a '\\' '/' | str replace -r '^\\./' '' | str downcase)
        let norm_pattern = ($pattern | str replace -a '\\' '/' | str replace -r '^\\./' '' | str downcase)
        if ($norm_prefix | str starts-with $norm_pattern) and (($norm_prefix | str length) > ($norm_pattern | str length)) {
          $prefix
        } else {
          $pattern
        }
      } else {
        $prefix
      }

      # Generate file completions based on type
      # Use current directory if glob_base is empty
      # Note: into glob is required so that ls expands wildcards from a variable
      let ls_pattern = if ($glob_base | is-empty) { "." } else { ($glob_base + "*" | into glob) }

      # Use ls -a to include hidden files when requested
      let items = try {
        match $type {
          "file" => {
            if ($extensions | is-empty) {
              (if $hidden { ls -a $ls_pattern } else { ls $ls_pattern }) | where type == file or type == dir
            } else {
              let ext_list = ($extensions | split row ',')
              let all_items = (if $hidden { ls -a $ls_pattern } else { ls $ls_pattern })
              let dirs = $all_items | where type == dir
              let files = $all_items | where type == file | where {|f|
                let ext = ($f.name | path parse | get extension)
                $ext in $ext_list
              }
              $dirs | append $files
            }
          },
          "directory" => {
            (if $hidden { ls -a $ls_pattern } else { ls $ls_pattern }) | where type == dir
          },
          "any" => {
            if ($extensions | is-empty) {
              if $hidden { ls -a $ls_pattern } else { ls $ls_pattern }
            } else {
              let ext_list = ($extensions | split row ',')
              let all_items = (if $hidden { ls -a $ls_pattern } else { ls $ls_pattern })
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

      # Format file completions
      $filtered | each {|item|
        let name = if $item.type == dir {
          $dir_prefix + ($item.name | path basename) + "/"
        } else {
          $dir_prefix + ($item.name | path basename)
        }
        { value: $name }
      }
    } else {
      # Regular literal completion - split by tab
      let parts = ($line | split row "\t")
      if ($parts | length) >= 2 {
        # value\\tdescription format
        { value: ($parts | get 0), description: ($parts | get 1) }
      } else if ($parts | length) == 1 and ($parts | get 0 | is-not-empty) {
        # Just value
        { value: ($parts | get 0) }
      } else {
        null
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
          : sanitizeDescription(
            formatMessage(suggestion.description, { colors: false }),
          );
        // Format: value\tdescription
        yield `${suggestion.text}\t${description}`;
      } else {
        // Emit special marker for native file completion
        const extensions = encodeExtensions(suggestion.extensions);
        const hidden = suggestion.includeHidden ? "1" : "0";
        const description = suggestion.description == null
          ? ""
          : sanitizeDescription(
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

    # Determine the range of elements to extract
    # Exclude the last element if it matches wordToComplete (partial input case)
    \$maxIndex = \$commandElements.Count - 1
    if (\$commandElements.Count -gt 1) {
        \$lastElement = \$commandElements[\$commandElements.Count - 1]
        \$lastText = if (\$lastElement -is [System.Management.Automation.Language.StringConstantExpressionAst]) {
            \$lastElement.Value
        } else {
            \$lastElement.Extent.Text
        }
        if (\$lastText -eq \$wordToComplete) {
            \$maxIndex = \$commandElements.Count - 2
        }
    }

    for (\$i = 1; \$i -le \$maxIndex; \$i++) {
        \$element = \$commandElements[\$i]

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
                \$prefix = if (\$normalizedPattern -and \$normalizedWord -and \$normalizedWord.StartsWith(\$normalizedPattern, [System.StringComparison]::OrdinalIgnoreCase) -and \$normalizedWord.Length -gt \$normalizedPattern.Length) {
                    \$wordToComplete
                } elseif (\$pattern) {
                    \$pattern
                } elseif (\$wordToComplete) {
                    \$wordToComplete
                } else { '' }

                # Use -Force to include hidden files when requested
                \$forceParam = if (\$hidden) { @{Force = \$true} } else { @{} }

                # Get file system items based on type
                \$items = @()
                switch (\$type) {
                    'file' {
                        if (\$extensions) {
                            # Filter by extensions, always include directories
                            \$extList = \$extensions -split ','
                            \$items = Get-ChildItem @forceParam -Path "\${prefix}*" -ErrorAction SilentlyContinue |
                                Where-Object {
                                    if (\$_.PSIsContainer) { return \$true }
                                    \$ext = \$_.Extension
                                    \$extList | ForEach-Object { if (\$ext -eq ".\$_") { return \$true } }
                                }
                        } else {
                            \$items = Get-ChildItem @forceParam -Path "\${prefix}*" -ErrorAction SilentlyContinue
                        }
                    }
                    'directory' {
                        \$items = Get-ChildItem @forceParam -Directory -Path "\${prefix}*" -ErrorAction SilentlyContinue
                    }
                    'any' {
                        if (\$extensions) {
                            # Filter by extensions, always include directories
                            \$extList = \$extensions -split ','
                            \$items = Get-ChildItem @forceParam -Path "\${prefix}*" -ErrorAction SilentlyContinue |
                                Where-Object {
                                    if (\$_.PSIsContainer) { return \$true }
                                    \$ext = \$_.Extension
                                    \$extList | ForEach-Object { if (\$ext -eq ".\$_") { return \$true } }
                                }
                        } else {
                            \$items = Get-ChildItem @forceParam -Path "\${prefix}*" -ErrorAction SilentlyContinue
                        }
                    }
                }

                # Filter hidden files unless requested
                if (-not \$hidden) {
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
          : sanitizeDescription(
            formatMessage(suggestion.description, { colors: false }),
          );
        // Format: text\tlistItemText\tdescription
        yield `${suggestion.text}\t${suggestion.text}\t${description}`;
      } else {
        // Emit special marker for native file completion
        const extensions = encodeExtensions(suggestion.extensions);
        const hidden = suggestion.includeHidden ? "1" : "0";
        const description = suggestion.description == null
          ? ""
          : sanitizeDescription(
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
