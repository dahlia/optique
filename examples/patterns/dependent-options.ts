import { flag, merge, object, option, withDefault } from "@optique/core/parser";
import { message } from "@optique/core/message";
import { print, run } from "@optique/run";

const unionParser = withDefault(
  object({
    flag: flag("-f", "--flag"),
    dependentFlag: option("-d", "--dependent-flag"),
    dependentFlag2: option("-D", "--dependent-flag-2"),
  }),
  { flag: false as const } as const,
);

const parser = merge(
  unionParser,
  object({
    normalFlag: option("-n", "--normal-flag"),
  }),
);

type Result =
  & (
    | { readonly flag: false }
    | {
      readonly flag: true;
      readonly dependentFlag: boolean;
      readonly dependentFlag2?: boolean;
    }
  )
  & { readonly normalFlag: boolean };

const result: Result = run(parser);
print(message`${JSON.stringify(result, null, 2)}`);
