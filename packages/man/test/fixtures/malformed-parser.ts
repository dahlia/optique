export default {
  parse() {
    return {
      success: true,
      consumed: [],
      next: { buffer: [], state: null, optionsTerminated: false, usage: [] },
    };
  },
  mode: "sync",
  usage: [],
};
