import { AlephaUI, mantineThemeAtom } from "@alepha/ui";
import { Alepha, run } from "alepha";
import { AppRouter } from "./AppRouter.tsx";

const alepha = Alepha.create();

alepha //
  .with(AlephaUI)
  .set(mantineThemeAtom, { id: "midnight" })
  .with(AppRouter);

run(alepha);
