import { useStore } from "@alepha/react";
import { useRouter } from "@alepha/react/router";
import { Spotlight, type SpotlightActionData } from "@mantine/spotlight";
import { IconSearch } from "@tabler/icons-react";
import { type ReactNode, useMemo } from "react";
import { ui } from "../../constants/ui.ts";
import { renderIcon } from "../../helpers/renderIcon.tsx";

export interface OmnibarProps {
  shortcut?: string | string[];
  searchPlaceholder?: string;
  nothingFound?: ReactNode;
}

const Omnibar = (props: OmnibarProps) => {
  const shortcut = props.shortcut ?? "mod+K";
  const searchPlaceholder = props.searchPlaceholder ?? "Search...";
  const nothingFound = props.nothingFound ?? "Nothing found...";
  const router = useRouter();

  // watch user to re-render on permission changes
  const [user] = useStore("alepha.server.request.user");

  const actions: SpotlightActionData[] = useMemo(
    () =>
      router.concretePages
        .filter((page) => {
          if (page.can && !page.can()) return false;

          return true;
        })
        .map((page) => ({
          id: page.name,
          label: page.label ?? page.name,
          description: page.description,
          onClick: () => {
            if (page.staticName) {
              return router.go(page.staticName, { params: page.params });
            }
            return router.go(page.name);
          },
          leftSection: renderIcon(page.icon),
        })),
    [user],
  );

  return (
    <Spotlight
      actions={actions}
      shortcut={shortcut}
      limit={10}
      searchProps={{
        leftSection: <IconSearch size={ui.sizes.icon.md} />,
        placeholder: searchPlaceholder,
      }}
      nothingFound={nothingFound}
    />
  );
};

export default Omnibar;
