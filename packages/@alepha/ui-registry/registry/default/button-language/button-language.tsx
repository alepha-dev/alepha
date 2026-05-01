import { useI18n } from "alepha/react/i18n";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface ButtonLanguageProps {
  /**
   * Optional aria-label override. Defaults to `"Switch language"`.
   */
  label?: string;
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={props.label ?? "Switch language"}
        >
          <Languages className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {languages.map((code) => {
          const translated = i18n.tr(`language.${code}` as never);
          const label = translated === `language.${code}` ? code : translated;
          return (
            <DropdownMenuCheckboxItem
              key={code}
              checked={i18n.lang === code}
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
