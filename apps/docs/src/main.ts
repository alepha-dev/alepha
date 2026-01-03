import { AlephaReactHead } from "@alepha/react/head";
import { AlephaReactI18n } from "@alepha/react/i18n";
import { Alepha, run } from "alepha";
import { AppRouter } from "./AppRouter.tsx";

const alepha = Alepha.create();

if (alepha.isBrowser()) {
  const stored = localStorage.getItem("alepha-docs-mode");
  const theme =
    stored === "light" || stored === "dark"
      ? stored
      : window.matchMedia?.("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
  document.documentElement.setAttribute("data-theme", theme);
}

alepha //
  .with(AlephaReactHead)
  .with(AlephaReactI18n)
  .with(AppRouter);

run(alepha);
