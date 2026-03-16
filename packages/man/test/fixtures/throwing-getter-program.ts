export default {
  get parser(): never {
    throw new Error("lazy init failure");
  },
  metadata: { name: "throwprog" },
};
