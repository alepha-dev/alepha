import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { cn } from "@alepha/ui/lib/utils";
import { Check, Palette } from "lucide-react";
import { useEffect, useState } from "react";

interface ThemeDef {
  id: string;
  label: string;
  /**
   * 4 swatch colors in 2×2 grid order (TL, TR, BL, BR).
   * Use any CSS-valid color string.
   */
  swatch: [string, string, string, string];
  /**
   * Google Fonts CSS URL to lazy-load when this theme is selected.
   * The CSS itself references fonts.gstatic.com woff2 files, fetched
   * on demand by the browser thanks to `font-display=swap`.
   */
  fontHref?: string;
}

const THEMES: ThemeDef[] = [
  {
    id: "shadcn",
    label: "Default",
    swatch: ["#0a0a0a", "#f4f4f5", "#ffffff", "#71717a"],
    fontHref:
      "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap",
  },
  {
    id: "github",
    label: "GitHub",
    swatch: ["#1f883d", "#0969da", "#f6f8fa", "#1f2328"],
  },
  {
    id: "parchment",
    label: "Parchment & Ink",
    swatch: ["#7a4a1f", "#d4a946", "#f5ecd6", "#2a1f10"],
    fontHref:
      "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;700&family=EB+Garamond:wght@400;600&display=swap",
  },
  {
    id: "cozy",
    label: "Cozy",
    swatch: ["#5a8a3a", "#e0a060", "#f5e8c8", "#3a4a2a"],
    fontHref:
      "https://fonts.googleapis.com/css2?family=Quicksand:wght@400;600&family=VT323&display=swap",
  },
  {
    id: "diablo",
    label: "Diablo",
    swatch: ["#a83228", "#d4a13a", "#1a0f08", "#e0c890"],
    fontHref:
      "https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&display=swap",
  },
  {
    id: "battlenet",
    label: "Battle.net",
    swatch: ["#148eff", "#f4a017", "#1a2840", "#e0e8f0"],
    fontHref:
      "https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700&display=swap",
  },
  {
    id: "ghibli",
    label: "Ghibli",
    swatch: ["#4a9bb8", "#e8a0a0", "#f5ecd0", "#5a7a4a"],
    fontHref:
      "https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Nunito:wght@400;700&display=swap",
  },
  {
    id: "claude",
    label: "Claude",
    swatch: ["#c46a3a", "#2a1f15", "#f5ecd8", "#8a6850"],
    fontHref:
      "https://fonts.googleapis.com/css2?family=Source+Serif+Pro:wght@400;600&display=swap",
  },
  {
    id: "brutal",
    label: "Neo Brutalism",
    swatch: ["#fadc00", "#ff3a8c", "#ffffff", "#0a0a0a"],
    fontHref:
      "https://fonts.googleapis.com/css2?family=Archivo+Black&family=Space+Grotesk:wght@400;500;700&display=swap",
  },
];

const STORAGE_KEY = "roadmap.theme";
const FONT_LINK_ID = "roadmap-theme-fonts";
const THEME_IDS = THEMES.map((t) => t.id);

const findTheme = (id: string): ThemeDef =>
  THEMES.find((t) => t.id === id) ?? THEMES[0];

const applyTheme = (id: string) => {
  const html = document.documentElement;
  for (const tid of THEME_IDS) {
    html.classList.remove(`theme-${tid}`);
  }
  if (id !== "shadcn") {
    html.classList.add(`theme-${id}`);
  }

  // Swap (or remove) the lazy-loaded font stylesheet.
  const existing = document.getElementById(FONT_LINK_ID);
  existing?.remove();
  const theme = findTheme(id);
  if (theme.fontHref) {
    const link = document.createElement("link");
    link.id = FONT_LINK_ID;
    link.rel = "stylesheet";
    link.href = theme.fontHref;
    document.head.appendChild(link);
  }
};

const readStoredTheme = (): string => {
  if (typeof window === "undefined") return "shadcn";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return THEME_IDS.includes(raw ?? "") ? (raw as string) : "shadcn";
};

export const ThemePicker = () => {
  const [theme, setTheme] = useState<string>("shadcn");

  useEffect(() => {
    const initial = readStoredTheme();
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const select = (id: string) => {
    setTheme(id);
    applyTheme(id);
    window.localStorage.setItem(STORAGE_KEY, id);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Pick theme">
          <Palette className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Themes</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => select(t.id)}
            className={cn(
              "hover:bg-accent flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm",
              theme === t.id && "bg-accent",
            )}
          >
            <ThemeSwatch colors={t.swatch} />
            <span className="flex-1 text-left">{t.label}</span>
            {theme === t.id && <Check className="size-3.5" />}
          </button>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

interface ThemeSwatchProps {
  colors: [string, string, string, string];
}

const ThemeSwatch = (props: ThemeSwatchProps) => {
  return (
    <div className="border-border grid size-6 shrink-0 grid-cols-2 grid-rows-2 gap-px overflow-hidden rounded-sm border bg-white p-px">
      {props.colors.map((c, i) => (
        <span
          key={i}
          className="block rounded-[1px]"
          style={{ background: c }}
        />
      ))}
    </div>
  );
};
