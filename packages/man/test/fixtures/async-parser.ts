/**
 * Test fixture: Async parser using @optique/git.
 */
import { object } from "@optique/core/constructs";
import { argument, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { optional } from "@optique/core/modifiers";
import { message } from "@optique/core/message";
import { gitBranch, gitTag } from "@optique/git";

export default object({
  ref: argument(gitBranch(), {
    description: message`Git branch to checkout.`,
  }),
  tagName: optional(
    option("-t", "--tag", gitTag(), {
      description: message`Git tag to use.`,
    }),
  ),
  message: optional(
    option("-m", "--message", string(), {
      description: message`Commit message.`,
    }),
  ),
});
