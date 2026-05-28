import * as React from "react";

void React;

import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { useI18n } from "alepha/react/i18n";
import { Languages } from "lucide-react";

const LABELS: Record<string, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
  de: "Deutsch",
  it: "Italiano",
  pt: "Português",
  ja: "日本語",
  zh: "中文",
};

const labelFor = (code: string) =>
  LABELS[code] ?? LABELS[code.split("-")[0]] ?? code.toUpperCase();

/**
 * Dropdown that lists every language registered via `$dictionary` and lets the
 * user switch. Reads the active language and the registered list directly from
 * `useI18n()`, so it stays in sync without extra wiring.
 */
export function LanguageToggle() {
  const i18n = useI18n();
  const languages = i18n.languages;

  if (languages.length <= 1) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Switch language" />
        }
      >
        <Languages className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {languages.map((code) => (
          <DropdownMenuCheckboxItem
            key={code}
            checked={i18n.lang === code}
            onCheckedChange={() => {
              void i18n.setLang(code);
            }}
          >
            {labelFor(code)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
