import { Alepha, run } from "alepha";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AppRouter } from "./AppRouter.tsx";

const alepha = Alepha.create();

alepha //
  .with(AlephaReactI18n)
  .with(AppRouter);

run(alepha);
