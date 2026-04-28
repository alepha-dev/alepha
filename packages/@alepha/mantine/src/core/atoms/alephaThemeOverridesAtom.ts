import { $atom, type Static, t } from "alepha";

export const alephaThemeOverridesAtom = $atom({
  name: "alepha.ui.themeOverrides",
  schema: t.object({
    primaryColor: t.optional(t.text()),
    radius: t.optional(t.text()),
    fontFamily: t.optional(t.text()),
    fontSize: t.optional(t.text()),
    scale: t.optional(t.text()),
  }),
  default: {},
});

export type AlephaThemeOverrides = Static<
  typeof alephaThemeOverridesAtom.schema
>;
