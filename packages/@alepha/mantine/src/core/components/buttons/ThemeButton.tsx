import { IconPalette } from "@tabler/icons-react";
import { useStore } from "alepha/react";
import { alephaThemeListAtom } from "../../atoms/alephaThemeListAtom.ts";
import { useDialog } from "../../hooks/useDialog.ts";
import { useTheme } from "../../hooks/useTheme.ts";
import type { ActionMenuItem } from "./ActionButton.tsx";
import ActionButton, { type ActionProps } from "./ActionButton.tsx";
import ThemeExpertModal from "./ThemeExpertModal.tsx";

type ThemeButtonProps = Partial<ActionProps> & {
  /**
   * Enable expert mode with color, radius, and font customization.
   */
  expert?: boolean;
};

const ThemeButton = (props: ThemeButtonProps) => {
  const { expert, ...actionProps } = props;
  const [theme, setTheme] = useTheme();
  const themeList = useStore(alephaThemeListAtom)[0];
  const dialog = useDialog();

  const items: ActionMenuItem[] = themeList.map((it, index) => ({
    label: it.name,
    onClick: () =>
      setTheme({
        index,
      }),
    active: theme.name === it.name,
  }));

  if (expert) {
    items.push(
      { type: "divider" },
      {
        label: "Customize...",
        onClick: () => {
          dialog.open({
            title: "Customize Theme",
            content: <ThemeExpertModal />,
          });
        },
      },
    );
  }

  return (
    <ActionButton
      variant="default"
      icon={IconPalette}
      menu={{
        items,
      }}
      {...actionProps}
    />
  );
};

export default ThemeButton;
