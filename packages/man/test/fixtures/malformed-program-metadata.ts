export default {
  parser: {
    parse() {
      return {
        success: true,
        consumed: [],
        next: { buffer: [], state: null, optionsTerminated: false, usage: [] },
      };
    },
    mode: "sync",
    usage: [],
    getDocFragments() {
      return {
        brief: undefined,
        description: undefined,
        fragments: [],
        footer: undefined,
      };
    },
  },
  metadata: { version: "1.0.0" },
};
