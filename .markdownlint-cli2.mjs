import customRules from "@hongminhee/markdownlint-rules";
import preset from "@hongminhee/markdownlint-rules/preset";

export default {
  customRules,
  config: preset,
  ignores: ["**/node_modules/**"],
};
