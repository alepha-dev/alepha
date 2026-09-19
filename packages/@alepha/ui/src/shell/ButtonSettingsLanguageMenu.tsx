import * as React from "react";

void React;

import { useI18n } from "alepha/react/i18n";
import { Languages } from "lucide-react";

import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../core/DropdownMenu.tsx";

export interface ButtonSettingsLanguageMenuProps {
  /**
   * Submenu label. Defaults to `"Language"`.
   */
  label?: string;
}

/**
 * The language picker as a submenu, for a dropdown that already exists: the
 * menu form of {@link ButtonLanguage}, with the same list, labels and rule.
 *
 * Labels come from `language.<code>`, falling back to the raw code, and the
 * submenu renders nothing when only one language is registered.
 */
export const ButtonSettingsLanguageMenu = (
  props: ButtonSettingsLanguageMenuProps,
) => {
  const i18n = useI18n();
  const languages = i18n.languages;

  if (languages.length <= 1) {
    return null;
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Languages className="size-4" />
        {props.label ?? "Language"}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={i18n.lang}
          onValueChange={(code: string) => {
            void i18n.setLang(code);
          }}
        >
          {languages.map((code) => {
            const translated = i18n.tr(`language.${code}` as never);
            return (
              // A single choice, so picking one closes the menu, as
              // `ButtonLanguage` does.
              <DropdownMenuRadioItem key={code} value={code} closeOnClick>
                {translated === `language.${code}` ? code : translated}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
};
