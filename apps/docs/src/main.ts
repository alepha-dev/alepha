import { AlephaUI, themeAtom } from "@alepha/ui";
import { Alepha, run } from "alepha";
import { AppRouter } from "./AppRouter.tsx";

const alepha = Alepha.create();

alepha.with(AlephaUI);
alepha.store.set(themeAtom, { id: "midnight" });

alepha.with(AppRouter);

run(alepha);
