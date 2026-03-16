export default {
  get parse(): never {
    throw new Error("lazy init failure");
  },
  $mode: "sync",
  usage: [],
  get getDocFragments(): never {
    throw new Error("lazy init failure");
  },
};
