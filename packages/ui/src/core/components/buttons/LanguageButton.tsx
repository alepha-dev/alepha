import { IconLanguage } from "@tabler/icons-react";
import { useI18n } from "alepha/react/i18n";
import ActionButton, { type ActionProps } from "./ActionButton.tsx";

const LanguageButton = (props: Partial<ActionProps>) => {
  const i18n = useI18n();
  return (
    <ActionButton
      variant={"subtle"}
      icon={IconLanguage}
      menu={{
        items: i18n.languages.map((lang) => ({
          label: i18n.tr(lang),
          onClick: () => i18n.setLang(lang),
          active: i18n.lang === lang,
        })),
      }}
      {...props}
    />
  );
};

export default LanguageButton;
