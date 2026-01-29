import { IconPalette } from "@tabler/icons-react";
import { useStore } from "alepha/react";
import { alephaThemeListAtom } from "../../atoms/alephaThemeListAtom.ts";
import { useTheme } from "../../hooks/useTheme.ts";
import ActionButton, { type ActionProps } from "./ActionButton.tsx";

export interface ThemeButtonProps {
  actionProps?: Partial<ActionProps>;
}

const ThemeButton = (props: ThemeButtonProps) => {
  const [theme, setTheme] = useTheme();
  const themeList = useStore(alephaThemeListAtom)[0];

  return (
    <ActionButton
      variant="subtle"
      icon={IconPalette}
      menu={{
        items: themeList.map((it, index) => ({
          label: it.name,
          onClick: () =>
            setTheme({
              index,
            }),
          active: theme.name === it.name,
        })),
      }}
      {...props.actionProps}
    />
  );
};

export default ThemeButton;
