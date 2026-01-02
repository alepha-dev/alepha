import { alephaThemeListAtom, midnightTheme } from "@alepha/ui";
import { Alepha, run } from "alepha";
import { AppRouter } from "./AppRouter.tsx";

const alepha = Alepha.create();

alepha.with(AppRouter);
alepha.set(alephaThemeListAtom, [midnightTheme]);

run(alepha);
