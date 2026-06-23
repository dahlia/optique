<script setup lang="ts">
import { computed, ref } from "vue";
import { object, or } from "@optique/core/constructs";
import { constant, option } from "@optique/core/primitives";
import { firstOf, hostname, ip, port, string } from "@optique/core/valueparser";
import { parseSync } from "@optique/core/parser";
import type { Message } from "@optique/core/message";

// The exact parser shown in the hero "The parser is the rule" card, kept in
// sync by hand. @optique/core is pure ECMAScript, so this is the real parser
// running in the browser — not a mock.
const auth = object({
  mode: constant("auth"),
  token: option("--token", string()),
  key: option("--key", string()),
});

const config = object({
  mode: constant("config"),
  host: option("--host", firstOf(ip(), hostname())),
  port: option("--port", port()),
});

const deploy = or(auth, config);

const presets = [
  { label: "auth", value: "--token a1b2c3 --key s3cr3t" },
  { label: "config · IP", value: "--host 10.0.0.1 --port 8080" },
  { label: "config · host", value: "--host db.example.com --port 5432" },
  { label: "both ✗", value: "--token a1 --host 10.0.0.1" },
  { label: "bad port ✗", value: "--host 10.0.0.1 --port 99999" },
] as const;

// Deterministic initial value: SSR and client hydration compute the same
// result, so no <ClientOnly> guard is needed. Editing only happens client-side.
const input = ref("--host 10.0.0.1 --port 8080");

type Seg = { readonly cls: string; readonly text: string };

// Render the structured Optique Message term by term rather than flattening it
// to a plain string, so option names, values, and metavars each get their own
// styling — the way a color terminal would show the same error.
function messageToSegs(msg: Message): Seg[] {
  const segs: Seg[] = [];
  for (const term of msg) {
    switch (term.type) {
      case "text":
        segs.push({ cls: "tx", text: term.text });
        break;
      case "optionName":
        segs.push({ cls: "opt", text: term.optionName });
        break;
      case "optionNames":
        term.optionNames.forEach((name, i) => {
          if (i > 0) segs.push({ cls: "pun", text: ", " });
          segs.push({ cls: "opt", text: name });
        });
        break;
      case "metavar":
        segs.push({ cls: "meta", text: term.metavar });
        break;
      case "value":
        segs.push({ cls: "val", text: JSON.stringify(term.value) });
        break;
      case "values":
        term.values.forEach((value, i) => {
          if (i > 0) segs.push({ cls: "pun", text: " " });
          segs.push({ cls: "val", text: JSON.stringify(value) });
        });
        break;
      case "envVar":
        segs.push({ cls: "opt", text: term.envVar });
        break;
      case "commandLine":
        segs.push({ cls: "tx", text: term.commandLine });
        break;
      case "url":
        segs.push({ cls: "opt", text: term.url.href });
        break;
      case "lineBreak":
        segs.push({ cls: "br", text: "" });
        break;
    }
  }
  return segs;
}

// The parsed value is a typed object; highlight it with the same palette as the
// error so the two states read as one language.
function valueToSegs(value: Record<string, unknown>): Seg[] {
  const segs: Seg[] = [{ cls: "pun", text: "{ " }];
  const entries = Object.entries(value);
  entries.forEach(([key, val], i) => {
    segs.push({ cls: "key", text: key });
    segs.push({ cls: "pun", text: ": " });
    segs.push(
      typeof val === "number"
        ? { cls: "num", text: String(val) }
        : { cls: "val", text: JSON.stringify(val) },
    );
    if (i < entries.length - 1) segs.push({ cls: "pun", text: ", " });
  });
  segs.push({ cls: "pun", text: " }" });
  return segs;
}

// POSIX Bourne-shell-style tokenizer: whitespace splits words, single and
// double quotes group (a quoted empty string is still a token), backslash
// escapes the next character, and an unquoted `#` at a word boundary starts a
// comment. No $ expansion or operators — this only splits an argv line the way
// a shell would before handing it to a program.
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let inWord = false;
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === "'") {
      inWord = true;
      i++;
      while (i < line.length && line[i] !== "'") cur += line[i++];
      i++;
    } else if (c === '"') {
      inWord = true;
      i++;
      while (i < line.length && line[i] !== '"') {
        if (
          line[i] === "\\" && i + 1 < line.length &&
          "\"\\$`".includes(line[i + 1])
        ) {
          cur += line[i + 1];
          i += 2;
        } else {
          cur += line[i++];
        }
      }
      i++;
    } else if (c === "\\") {
      inWord = true;
      if (i + 1 < line.length) cur += line[i + 1];
      i += 2;
    } else if (c === "#" && !inWord) {
      break;
    } else if (c === " " || c === "\t" || c === "\n") {
      if (inWord) {
        tokens.push(cur);
        cur = "";
        inWord = false;
      }
      i++;
    } else {
      cur += c;
      inWord = true;
      i++;
    }
  }
  if (inWord) tokens.push(cur);
  return tokens;
}

const result = computed(() => {
  const tokens = tokenize(input.value);
  const parsed = parseSync(deploy, tokens);
  return parsed.success
    ? { ok: true, segs: valueToSegs(parsed.value as Record<string, unknown>) }
    : { ok: false, segs: messageToSegs(parsed.error) };
});
</script>

<template>
  <div class="ol-run">
    <div class="ol-run__chips">
      <button
        v-for="p in presets"
        :key="p.label"
        type="button"
        class="ol-run__chip"
        :class="{ 'is-active': input === p.value }"
        @click="input = p.value"
      >{{ p.label }}</button>
    </div>

    <div class="ol-run__term">
      <div class="ol-run__line">
        <span class="ol-run__prompt">$ myapp</span>
        <input
          v-model="input"
          class="ol-run__input"
          type="text"
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          autocorrect="off"
          aria-label="Command-line arguments to parse"
        />
      </div>
      <p class="ol-run__out" :class="result.ok ? 'is-ok' : 'is-err'">
        <span class="ol-run__mark">{{ result.ok ? "✓" : "✗" }}</span>
        <span class="ol-run__msg"><template
          v-for="(s, i) in result.segs"
          :key="i"
        ><br v-if="s.cls === 'br'"><span v-else :class="`ol-seg-${s.cls}`">{{ s.text }}</span></template></span>
      </p>
    </div>
  </div>
</template>

<style scoped>
.ol-run {
  max-width: 720px;
  margin: 8px 0 0;
}

.ol-run__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.ol-run__chip {
  appearance: none;
  padding: 5px 12px;
  border: 1px solid var(--vp-c-border);
  border-radius: 999px;
  background: var(--vp-c-bg-soft);
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background-color 0.15s;
}

.ol-run__chip:hover {
  border-color: var(--vp-c-brand-2);
  color: var(--vp-c-brand-1);
}

.ol-run__chip.is-active {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.ol-run__term {
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  background: var(--vp-c-bg-elv);
  padding: 18px 20px;
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  transition: border-color 0.15s;
}

.ol-run__term:focus-within {
  border-color: var(--vp-c-brand-1);
}

.ol-run__line {
  display: flex;
  align-items: center;
  gap: 9px;
}

.ol-run__prompt {
  flex: none;
  color: var(--vp-c-text-3);
  white-space: nowrap;
  user-select: none;
}

.ol-run__input {
  flex: 1;
  min-width: 0;
  appearance: none;
  border: 0;
  background: transparent;
  padding: 4px 0;
  font-family: inherit;
  font-size: inherit;
  color: var(--vp-c-text-1);
  caret-color: var(--vp-c-brand-1);
  outline: none;
}

.ol-run__out {
  display: flex;
  gap: 9px;
  margin: 14px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--vp-c-divider);
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.ol-run__out.is-ok {
  color: var(--vp-c-text-1);
}

.ol-run__out.is-err {
  color: var(--vp-c-text-2);
}

.ol-run__mark {
  flex: none;
  font-weight: 700;
}

.ol-run__out.is-ok .ol-run__mark {
  color: var(--optique-spectrum-3);
}

.dark .ol-run__out.is-ok .ol-run__mark {
  color: #5eead4;
}

.ol-run__out.is-err .ol-run__mark {
  color: #e5484d;
}

/* Per-term styling, shared by the parsed value and the error message. */
.ol-seg-tx {
  color: inherit;
}

.ol-seg-pun {
  color: var(--vp-c-text-3);
}

.ol-seg-key {
  color: var(--vp-c-text-1);
}

.ol-seg-opt {
  color: var(--vp-c-brand-1);
  font-weight: 500;
}

.ol-seg-meta,
.ol-seg-num {
  color: var(--optique-spectrum-2);
}

.ol-seg-meta {
  font-weight: 500;
}

.dark .ol-seg-meta,
.dark .ol-seg-num {
  color: #8b9bf4;
}

.ol-seg-val {
  color: #b45309;
}

.dark .ol-seg-val {
  color: #fbbf24;
}
</style>
