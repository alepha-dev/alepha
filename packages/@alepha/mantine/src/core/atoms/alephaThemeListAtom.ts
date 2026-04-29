import { $atom, type Static, t } from "alepha";
import type { AlephaTheme } from "../interfaces/AlephaTheme.ts";
import { defaultTheme } from "./themes/default.ts";
import { editorialTheme } from "./themes/editorial.ts";
import { midnightTheme } from "./themes/midnight.ts";
import { monochromeTheme } from "./themes/monochrome.ts";
import { rosePineTheme } from "./themes/rosePine.ts";
import { softBrutalismTheme } from "./themes/softBrutalism.ts";
import { terminalTheme } from "./themes/terminal.ts";

export const alephaThemeListAtom = $atom({
  name: "alepha.ui.themeList",
  schema: t.array(t.json<AlephaTheme>()), // TODO: translate to proper schema
  default: [
    defaultTheme,
    midnightTheme,
    softBrutalismTheme,
    terminalTheme,
    editorialTheme,
    rosePineTheme,
    monochromeTheme,
  ],
});

export type AlephaThemeListAtom = Static<typeof alephaThemeListAtom.schema>;
