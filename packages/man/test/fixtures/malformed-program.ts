export default {
  parser: {
    parse() {
      return {
        success: true,
        consumed: [],
        next: { buffer: [], state: null, optionsTerminated: false, usage: [] },
      };
    },
    $mode: "sync",
    usage: [],
  },
  metadata: { name: "badprog" },
};
