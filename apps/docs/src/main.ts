import { AlephaUI, alephaThemeListAtom, midnightTheme } from "@alepha/ui";
import { Alepha, run } from "alepha";
import { AppRouter } from "./AppRouter.tsx";

const alepha = Alepha.create();

alepha //
  .with(AlephaUI)
  .set(alephaThemeListAtom, [
    {
      ...midnightTheme,
      primaryColor: "pink",
      fontFamily: "wotfardregular",
      defaultColorScheme: "dark",
    },
  ])
  .with(AppRouter);

run(alepha);
