import { $atom, t } from "alepha";
import type { AlephaTheme } from "../interfaces/AlephaTheme.ts";
import { defaultTheme } from "./themes/default.ts";
import { midnightTheme } from "./themes/midnight.ts";

export const alephaThemeListAtom = $atom({
  name: "alepha.ui.themeList",
  schema: t.array(t.json<AlephaTheme>()), // TODO: translate to proper schema
  default: [defaultTheme, midnightTheme],
});
