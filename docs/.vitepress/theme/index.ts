import TwoslashFloatingVue from "@shikijs/vitepress-twoslash/client";
import type { EnhanceAppContext } from "vitepress";
import Theme from "vitepress/theme";

import "@fontsource-variable/space-grotesk";
import "virtual:group-icons.css";
import "./style.css";
import "./landing.css";
import "@shikijs/vitepress-twoslash/style.css";

import CodeCard from "./components/CodeCard.vue";
import Cols from "./components/Cols.vue";
import CommandFork from "./components/CommandFork.vue";
import CommandGrammar from "./components/CommandGrammar.vue";
import CompletionDemo from "./components/CompletionDemo.vue";
import LandingSection from "./components/LandingSection.vue";
import OptiquePrism from "./components/OptiquePrism.vue";
import PackageGrid from "./components/PackageGrid.vue";
import ParserCatalog from "./components/ParserCatalog.vue";
import RunsOn from "./components/RunsOn.vue";
import SurfaceTabs from "./components/SurfaceTabs.vue";

export default {
  extends: Theme,
  enhanceApp({ app }: EnhanceAppContext) {
    app.use(TwoslashFloatingVue);
    app.component("CodeCard", CodeCard);
    app.component("Cols", Cols);
    app.component("CommandFork", CommandFork);
    app.component("CommandGrammar", CommandGrammar);
    app.component("CompletionDemo", CompletionDemo);
    app.component("LandingSection", LandingSection);
    app.component("OptiquePrism", OptiquePrism);
    app.component("PackageGrid", PackageGrid);
    app.component("ParserCatalog", ParserCatalog);
    app.component("RunsOn", RunsOn);
    app.component("SurfaceTabs", SurfaceTabs);
  },
};
