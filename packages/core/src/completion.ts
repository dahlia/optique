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

/**
 * The fish shell completion generator.
 * @since 0.6.0
 */
export const fish: ShellCompletion = {
  name: "fish",
  generateScript(programName: string, args: readonly string[] = []): string {
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
            set -l parts (string split ':' -- $line)
            set -l type $parts[2]
            set -l extensions $parts[3]
            set -l pattern $parts[4]
            set -l hidden $parts[5]

            # Generate file completions based on type
            set -l items
            switch $type
                case file
                    # Complete files only
                    for item in $current*
                        if test -f $item
                            set -a items $item
                        end
                    end
                case directory
                    # Complete directories only
                    for item in $current*
                        if test -d $item
                            set -a items $item/
                        end
                    end
                case any
                    # Complete both files and directories
                    for item in $current*
                        if test -d $item
                            set -a items $item/
                        else if test -f $item
                            set -a items $item
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

            # Filter out hidden files unless requested
            if test "$hidden" != "1" -a (string sub -l 1 -- $current) != "."
                set -l filtered
                for item in $items
                    set -l basename (basename $item)
                    if not string match -q '.*' -- $basename
                        set -a filtered $item
                    end
                end
                set items $filtered
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
          : formatMessage(suggestion.description, { colors: false });
        // Format: value\tdescription
        yield `${suggestion.text}\t${description}`;
      } else {
        // Emit special marker for native file completion
        const extensions = suggestion.extensions?.join(",") || "";
        const hidden = suggestion.includeHidden ? "1" : "0";
        const description = suggestion.description == null
          ? ""
          : formatMessage(suggestion.description, { colors: false });
        yield `__FILE__:${suggestion.type}:${extensions}:${
          suggestion.pattern || ""
        }:${hidden}\t${description}`;
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
                \$parts = \$line -split ':', 5
                \$type = \$parts[1]
                \$extensions = \$parts[2]
                \$pattern = \$parts[3]
                \$hidden = \$parts[4] -eq '1'

                # Determine current prefix for file matching
                \$prefix = if (\$wordToComplete) { \$wordToComplete } else { '' }

                # Get file system items based on type
                \$items = @()
                switch (\$type) {
                    'file' {
                        if (\$extensions) {
                            # Filter by extensions
                            \$extList = \$extensions -split ','
                            \$items = Get-ChildItem -File -Path "\${prefix}*" -ErrorAction SilentlyContinue |
                                Where-Object {
                                    \$ext = \$_.Extension
                                    \$extList | ForEach-Object { if (\$ext -eq ".\$_") { return \$true } }
                                }
                        } else {
                            \$items = Get-ChildItem -File -Path "\${prefix}*" -ErrorAction SilentlyContinue
                        }
                    }
                    'directory' {
                        \$items = Get-ChildItem -Directory -Path "\${prefix}*" -ErrorAction SilentlyContinue
                    }
                    'any' {
                        if (\$extensions) {
                            # Get directories and filtered files
                            \$dirs = Get-ChildItem -Directory -Path "\${prefix}*" -ErrorAction SilentlyContinue
                            \$extList = \$extensions -split ','
                            \$files = Get-ChildItem -File -Path "\${prefix}*" -ErrorAction SilentlyContinue |
                                Where-Object {
                                    \$ext = \$_.Extension
                                    \$extList | ForEach-Object { if (\$ext -eq ".\$_") { return \$true } }
                                }
                            \$items = \$dirs + \$files
                        } else {
                            \$items = Get-ChildItem -Path "\${prefix}*" -ErrorAction SilentlyContinue
                        }
                    }
                }

                # Filter hidden files unless requested
                if (-not \$hidden) {
                    \$items = \$items | Where-Object { -not \$_.Attributes.HasFlag([System.IO.FileAttributes]::Hidden) }
                }

                # Create completion results for files
                \$items | ForEach-Object {
                    \$completionText = if (\$_.PSIsContainer) { "\$(\$_.Name)/" } else { \$_.Name }
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
          : formatMessage(suggestion.description, { colors: false });
        // Format: text\tlistItemText\tdescription
        yield `${suggestion.text}\t${suggestion.text}\t${description}`;
      } else {
        // Emit special marker for native file completion
        const extensions = suggestion.extensions?.join(",") || "";
        const hidden = suggestion.includeHidden ? "1" : "0";
        const description = suggestion.description == null
          ? ""
          : formatMessage(suggestion.description, { colors: false });
        yield `__FILE__:${suggestion.type}:${extensions}:${
          suggestion.pattern || ""
        }:${hidden}\t[file]\t${description}`;
      }
      i++;
    }
  },
};

// cSpell: ignore: COMPREPLY compdef commandline
