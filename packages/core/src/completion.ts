import { formatMessage } from "./message.ts";
import type { Suggestion } from "./parser.ts";

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

      # Generate file completions based on type
      case "$type" in
        file)
          # Complete files only
          if [[ -n "$extensions" ]]; then
            # Complete with extension filtering
            local ext_pattern="\${extensions//,/|}"
            for file in "$current"*; do
              [[ -e "$file" && "$file" =~ \\.($ext_pattern)$ ]] && COMPREPLY+=("$file")
            done
          else
            # Complete files only, exclude directories
            while IFS= read -r -d '' item; do
              [[ -f "$item" ]] && COMPREPLY+=("$item")
            done < <(compgen -f -z -- "$current")
          fi
          ;;
        directory)
          # Complete directories only
          while IFS= read -r -d '' dir; do
            COMPREPLY+=("$dir/")
          done < <(compgen -d -z -- "$current")
          ;;
        any)
          # Complete both files and directories
          if [[ -n "$extensions" ]]; then
            # Files with extension filtering + directories
            # Files with extension filtering
            local ext_pattern="\${extensions//,/|}"
            for item in "$current"*; do
              if [[ -d "$item" ]]; then
                COMPREPLY+=("$item/")
              elif [[ -f "$item" && "$item" =~ \\.($ext_pattern)$ ]]; then
                COMPREPLY+=("$item")
              fi
            done
          else
            # Complete files and directories, add slash to directories
            while IFS= read -r -d '' item; do
              if [[ -d "$item" ]]; then
                COMPREPLY+=("$item/")
              else
                COMPREPLY+=("$item")
              fi
            done < <(compgen -f -z -- "$current")
          fi
          ;;
      esac

      # Filter out hidden files unless requested
      if [[ "$hidden" != "1" && "$current" != .* ]]; then
        local filtered=()
        for item in "\${COMPREPLY[@]}"; do
          [[ "$(basename "$item")" != .* ]] && filtered+=("$item")
        done
        COMPREPLY=("\${filtered[@]}")
      fi
    else
      # Regular literal completion
      COMPREPLY+=("$line")
    fi
  done < <(${programName} ${escapedArgs} "\${prev[@]}" "$current" 2>/dev/null)
}

complete -F _${programName} ${programName}
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
        const extensions = suggestion.extensions?.join(",") || "";
        const hidden = suggestion.includeHidden ? "1" : "0";
        yield `__FILE__:${suggestion.type}:${extensions}:${
          suggestion.pattern || ""
        }:${hidden}`;
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
        has_file_completion=1

        # Use zsh's native file completion
        case "\$type" in
          file)
            if [[ -n "\$extensions" ]]; then
              # Complete files with extension filtering
              local ext_pattern="*.(\\$\{extensions//,/|\})"
              _files -g "\\$ext_pattern"
            else
              _files -g "*"
            fi
            ;;
          directory)
            _directories
            ;;
          any)
            if [[ -n "\$extensions" ]]; then
              # Complete both files and directories, with extension filtering for files
              local ext_pattern="*.(\\$\{extensions//,/|\})"
              _files -g "\\$ext_pattern" && _directories
            else
              _files
            fi
            ;;
        esac

        # Note: zsh's _files and _directories handle hidden file filtering automatically
        # based on the completion context and user settings
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
          : formatMessage(suggestion.description, { colors: false });
        yield `${suggestion.text}\0${description}\0`;
      } else {
        // Emit special marker for native file completion
        const extensions = suggestion.extensions?.join(",") || "";
        const hidden = suggestion.includeHidden ? "1" : "0";
        const description = suggestion.description == null
          ? ""
          : formatMessage(suggestion.description, { colors: false });
        yield `__FILE__:${suggestion.type}:${extensions}:${
          suggestion.pattern || ""
        }:${hidden}\0${description}\0`;
      }
    }
  },
};

// cSpell: ignore: COMPREPLY compdef
