import { IconPalette } from "@tabler/icons-react";
import { useStore } from "alepha/react";
import { alephaThemeListAtom } from "../../atoms/alephaThemeListAtom.ts";
import { useTheme } from "../../hooks/useTheme.ts";
import ActionButton, { type ActionProps } from "./ActionButton.tsx";

const ThemeButton = (props: Partial<ActionProps>) => {
  const [theme, setTheme] = useTheme();
  const themeList = useStore(alephaThemeListAtom)[0];

  return (
    <ActionButton
      variant="default"
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
      {...props}
    />
  );
};

export default ThemeButton;
