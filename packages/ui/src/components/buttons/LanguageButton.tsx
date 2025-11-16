import { useI18n } from "@alepha/react/i18n";
import { IconLanguage } from "@tabler/icons-react";
import ActionButton, { type ActionProps } from "./ActionButton.tsx";

export interface LanguageButtonProps {
  languages?: string[];
  actionProps?: ActionProps;
}

const LanguageButton = (props: LanguageButtonProps) => {
  const i18n = useI18n();
  return (
    <ActionButton
      icon={<IconLanguage />}
      variant={"outline"}
      menu={{
        items: i18n.languages.map((lang) => ({
          label: i18n.tr(lang),
          onClick: () => i18n.setLang(lang),
          active: i18n.lang === lang,
        })),
      }}
      {...props.actionProps}
    />
  );
};

export default LanguageButton;
