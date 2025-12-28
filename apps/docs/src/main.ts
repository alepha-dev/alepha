import { AlephaReactHead } from "@alepha/react/head";
import { AlephaReactI18n } from "@alepha/react/i18n";
import { Alepha, run } from "alepha";
import { AppRouter } from "./AppRouter.tsx";

const alepha = Alepha.create();

alepha //
  .with(AlephaReactHead)
  .with(AlephaReactI18n)
  .with(AppRouter);

run(alepha);
