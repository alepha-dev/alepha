import { $dictionary } from "@alepha/react/i18n";

export class AppI18n {
  en = $dictionary({
    lazy: () => import("./locales/en.json"),
  });

  fr = $dictionary({
    lazy: () => import("./locales/fr.json"),
  });
}
