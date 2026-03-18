import { $atom, type Static, t } from "alepha";

export const alephaThemeAtom = $atom({
  name: "alepha.ui.theme",
  schema: t.object({
    index: t.integer(),
  }),
  default: {
    index: 0,
  },
});

export type CurrentAlephaTheme = Static<typeof alephaThemeAtom.schema>;
