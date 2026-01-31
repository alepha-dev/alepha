import { Alepha, run } from "alepha";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AppRouter } from "./AppRouter.tsx";

const alepha = Alepha.create({
  env: {
    APP_NAME: "DOCS",
  },
});

alepha //
  .with(AlephaReactI18n)
  .with(AppRouter);

run(alepha);
