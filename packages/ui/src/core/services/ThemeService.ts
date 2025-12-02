import { $head } from "@alepha/react/head";
import { $atom, type Static, t } from "alepha";
import { $cookie } from "alepha/server/cookies";

export const themeAtom = $atom({
  name: "alepha.ui.theme",
  schema: t.object({
    id: t.string(),
    primaryColor: t.optional(t.text()),
    primaryShade: t.optional(
      t.object({
        light: t.integer(),
        dark: t.integer(),
      }),
    ),
  }),
  default: {
    id: "default",
    primaryColor: "gray",
  },
});

export type Theme = Static<typeof themeAtom.schema>;

export class ThemeService {
  protected themeCookie = $cookie(themeAtom);

  public themes = [
    {
      id: "default",
      label: "Default",
      primaryColor: "orange",
      primaryShade: { light: 6, dark: 7 },
    },
    {
      id: "github",
      label: "GitHub",
      primaryColor: "blue",
      primaryShade: { light: 5, dark: 4 },
    },
    {
      id: "claude",
      label: "Claude",
      primaryColor: "orange",
      primaryShade: { light: 5, dark: 4 },
    },
    {
      id: "chatgpt",
      label: "ChatGPT",
      primaryColor: "teal",
      primaryShade: { light: 5, dark: 5 },
    },
    {
      id: "shadcn",
      label: "shadcn",
      primaryColor: "dark",
      primaryShade: { light: 9, dark: 0 },
    },
    {
      id: "macos",
      label: "macOS",
      primaryColor: "blue",
      primaryShade: { light: 5, dark: 4 },
    },
    {
      id: "youtube",
      label: "YouTube",
      primaryColor: "red",
      primaryShade: { light: 5, dark: 5 },
    },
    {
      id: "whatsapp",
      label: "WhatsApp",
      primaryColor: "teal",
      primaryShade: { light: 5, dark: 5 },
    },
    {
      id: "ocean",
      label: "Ocean",
      primaryColor: "blue",
      primaryShade: { light: 5, dark: 4 },
    },
    {
      id: "forest",
      label: "Forest",
      primaryColor: "green",
      primaryShade: { light: 5, dark: 4 },
    },
    {
      id: "sunset",
      label: "Sunset",
      primaryColor: "orange",
      primaryShade: { light: 5, dark: 4 },
    },
    {
      id: "lavender",
      label: "Lavender",
      primaryColor: "violet",
      primaryShade: { light: 5, dark: 4 },
    },
    {
      id: "rose",
      label: "Rose",
      primaryColor: "pink",
      primaryShade: { light: 5, dark: 4 },
    },
    {
      id: "monochrome",
      label: "Monochrome",
      primaryColor: "gray",
      primaryShade: { light: 7, dark: 7 },
    },
    {
      id: "dracula",
      label: "Dracula",
      primaryColor: "violet",
      primaryShade: { light: 4, dark: 4 },
    },
  ];

  protected themeHead = $head(() => {
    return {
      htmlAttributes: {
        "data-theme": this.getTheme().id,
      },
    };
  });

  public setTheme(theme: Theme) {
    this.themeCookie.set(theme);
  }

  public getTheme() {
    // TODO: make a safe cookie getter, today it crash when Cookie Server is called inside vite pre-render
    try {
      return this.themeCookie.get() ?? themeAtom.options.default;
    } catch {
      return themeAtom.options.default;
    }
  }
}
