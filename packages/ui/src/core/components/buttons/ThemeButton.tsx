import { useInject } from "@alepha/react";
import { IconPalette } from "@tabler/icons-react";
import { useTheme } from "../../hooks/useTheme.ts";
import { ThemeProvider } from "../../providers/ThemeProvider.ts";
import ActionButton, { type ActionProps } from "./ActionButton.tsx";

export interface ThemeButtonProps {
  actionProps?: Partial<ActionProps>;
}

const ThemeButton = (props: ThemeButtonProps) => {
  const [theme, setTheme] = useTheme();
  const themes = useInject(ThemeProvider).themes;

  return (
    <ActionButton
      variant="subtle"
      icon={IconPalette}
      menu={{
        items: themes.map((it) => ({
          label: it.label,
          onClick: () => setTheme(it),
          active: theme.id === it.id,
        })),
      }}
      {...props.actionProps}
    />
  );
};

export default ThemeButton;
