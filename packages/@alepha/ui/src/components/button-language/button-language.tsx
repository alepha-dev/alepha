import * as React from "react";

void React;

import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useI18n } from "alepha/react/i18n";
import { Languages } from "lucide-react";

export interface ButtonLanguageProps {
  /**
   * Optional aria-label override. Defaults to `"Switch language"`.
   */
  label?: string;
  /**
   * Visual variant. Defaults to `"ghost"` (minimal). Pass `"outline"` for a
   * bordered toolbar look.
   */
  variant?: "ghost" | "outline";
}

/**
 * Dropdown listing every language registered via `$dictionary`. Switches the
 * active locale via `useI18n().setLang(code)`.
 *
 * Labels come from translation keys `language.<code>` (e.g. `language.en`,
 * `language.fr`). If the key is missing, the raw code is shown — so adding a
 * new language to the picker is a one-line `tr` entry per dictionary.
 *
 * Renders nothing when only one language is registered.
 */
export function ButtonLanguage(props: ButtonLanguageProps) {
  const i18n = useI18n();
  const languages = i18n.languages;

  if (languages.length <= 1) {
    return null;
  }

  const label = props.label ?? "Switch language";
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant={props.variant ?? "ghost"}
                  size="icon"
                  aria-label={label}
                />
              }
            />
          }
        >
          <Languages className="size-4" />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        {languages.map((code) => {
          const translated = i18n.tr(`language.${code}` as never);
          const label = translated === `language.${code}` ? code : translated;
          return (
            <DropdownMenuCheckboxItem
              key={code}
              checked={i18n.lang === code}
              /*
               * Checkbox items keep the menu open by default, which is right when
               * you are ticking several things and wrong here: a language is a
               * single choice, and the menu stayed hanging over the page after
               * you made it. Closing on click also means the ticked state is
               * something you see on reopening rather than a leftover panel.
               */
              closeOnClick
              onCheckedChange={() => {
                void i18n.setLang(code);
              }}
            >
              {label}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
