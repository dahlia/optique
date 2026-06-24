<script setup lang="ts">
// The actual catalog, so "batteries included" is shown rather than claimed.
// Value parsers are grouped by what they parse; combinators by the module they
// live in. Each chip links to its reference section. Names and anchors mirror
// the real exports and headings across the @optique/* docs.
const valueParsers = [
  {
    group: "Text & choice",
    base: "/concepts/valueparsers",
    items: [
      ["string", "string-parser"],
      ["choice", "choice-parser"],
      ["firstOf", "firstof-combinator"],
      ["keyValue", "keyvalue-parser"],
    ],
  },
  {
    group: "Numbers",
    base: "/concepts/valueparsers",
    items: [
      ["integer", "integer-parser"],
      ["float", "float-parser"],
      ["port", "port-parser"],
      ["portRange", "portrange-parser"],
      ["fileSize", "filesize-parser"],
    ],
  },
  {
    group: "Network",
    base: "/concepts/valueparsers",
    items: [
      ["url", "url-parser"],
      ["ip", "ip-parser"],
      ["ipv4", "ipv4-parser"],
      ["ipv6", "ipv6-parser"],
      ["cidr", "cidr-parser"],
      ["hostname", "hostname-parser"],
      ["domain", "domain-parser"],
      ["email", "email-parser"],
      ["socketAddress", "socketaddress-parser"],
      ["macAddress", "macaddress-parser"],
    ],
  },
  {
    group: "Format & ID",
    base: "/concepts/valueparsers",
    items: [
      ["uuid", "uuid-parser"],
      ["semVer", "semver-parser"],
      ["color", "color-parser"],
      ["locale", "locale-parser"],
      ["json", "json-parser"],
      ["cron", "cron-parser"],
    ],
  },
  {
    group: "Filesystem",
    base: "/concepts/valueparsers",
    items: [["path", "path-parser"]],
  },
  {
    group: "Date & time",
    base: "/integrations/temporal",
    items: [
      ["instant", "instant-parser"],
      ["duration", "duration-parser"],
      ["plainDate", "plaindate-parser"],
      ["plainTime", "plaintime-parser"],
      ["plainDateTime", "plaindatetime-parser"],
      ["zonedDateTime", "zoneddatetime-parser"],
      ["plainYearMonth", "plainyearmonth-parser"],
      ["plainMonthDay", "plainmonthday-parser"],
      ["timeZone", "timezone-parser"],
    ],
  },
  {
    group: "Git refs",
    base: "/integrations/git",
    items: [
      ["gitBranch", "gitbranch"],
      ["gitTag", "gittag"],
      ["gitCommit", "gitcommit"],
      ["gitRef", "gitref"],
      ["gitRemote", "gitremote"],
      ["gitRemoteBranch", "gitremotebranch"],
    ],
  },
] as const;

const combinators = [
  {
    group: "Primitives",
    base: "/concepts/primitives",
    items: [
      ["option", "option-parser"],
      ["flag", "flag-parser"],
      ["argument", "argument-parser"],
      ["command", "command-parser"],
      ["constant", "constant-parser"],
    ],
  },
  {
    group: "Constructs",
    base: "/concepts/constructs",
    items: [
      ["object", "object-parser"],
      ["merge", "merge-parser"],
      ["or", "or-parser"],
      ["tuple", "tuple-parser"],
      ["seq", "seq-parser"],
      ["group", "group-parser"],
      ["conditional", "conditional-parser"],
    ],
  },
  {
    group: "Modifiers",
    base: "/concepts/modifiers",
    items: [
      ["optional", "optional-parser"],
      ["withDefault", "withdefault-parser"],
      ["multiple", "multiple-parser"],
      ["map", "map-parser"],
    ],
  },
] as const;

const count = (groups: readonly { readonly items: readonly unknown[] }[]) =>
  groups.reduce((n, g) => n + g.items.length, 0);
const valueParserCount = count(valueParsers);
const combinatorCount = count(combinators);
</script>

<template>
  <div class="ol-catalog">
    <div class="ol-catalog__group">
      <p class="ol-catalog__kind">
        Value parsers
        <span class="ol-catalog__count">{{ valueParserCount }}</span>
      </p>
      <div class="ol-catalog__rows">
        <div v-for="cat in valueParsers" :key="cat.group" class="ol-catalog__row">
          <span class="ol-catalog__label">{{ cat.group }}</span>
          <div class="ol-catalog__chips">
            <a
              v-for="item in cat.items"
              :key="item[0]"
              class="ol-cat-chip"
              :href="`${cat.base}#${item[1]}`"
            >{{ item[0] }}<span class="ol-cat-chip__paren">()</span></a>
          </div>
        </div>
      </div>
      <p class="ol-catalog__note">
        …plus any <a href="/integrations/zod">Zod</a>,
        <a href="/integrations/valibot">Valibot</a>, or Standard Schema validator,
        reused as a value parser.
      </p>
    </div>

    <div class="ol-catalog__group">
      <p class="ol-catalog__kind">
        Combinators
        <span class="ol-catalog__count">{{ combinatorCount }}</span>
      </p>
      <div class="ol-catalog__rows">
        <div v-for="cat in combinators" :key="cat.group" class="ol-catalog__row">
          <span class="ol-catalog__label">{{ cat.group }}</span>
          <div class="ol-catalog__chips">
            <a
              v-for="item in cat.items"
              :key="item[0]"
              class="ol-cat-chip"
              :href="`${cat.base}#${item[1]}`"
            >{{ item[0] }}<span class="ol-cat-chip__paren">()</span></a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ol-catalog {
  margin: 4px 0 44px;
}

.ol-catalog__group + .ol-catalog__group {
  margin-top: 30px;
}

.ol-catalog__kind {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 16px;
  font-family: var(--optique-font-display);
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.ol-catalog__count {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.ol-catalog__rows {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ol-catalog__row {
  display: grid;
  grid-template-columns: 116px 1fr;
  gap: 6px 16px;
  align-items: baseline;
}

.ol-catalog__label {
  padding-top: 4px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--vp-c-text-3);
}

.ol-catalog__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.ol-cat-chip {
  padding: 4px 9px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 7px;
  background: var(--vp-c-bg-soft);
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
  font-weight: 400;
  line-height: 1.3;
  color: var(--vp-c-text-1);
  text-decoration: none;
  white-space: nowrap;
  transition: border-color 0.15s, color 0.15s, background-color 0.15s;
}

.ol-cat-chip:hover {
  border-color: var(--vp-c-brand-2);
  background: var(--vp-c-bg-elv);
  color: var(--vp-c-brand-1);
}

.ol-cat-chip__paren {
  color: var(--vp-c-text-3);
}

.ol-cat-chip:hover .ol-cat-chip__paren {
  color: var(--vp-c-brand-2);
}

.ol-catalog__note {
  margin: 16px 0 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}

@media (max-width: 720px) {
  .ol-catalog__row {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .ol-catalog__label {
    padding-top: 0;
  }
}
</style>
