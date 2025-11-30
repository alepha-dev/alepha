import { useRouter } from "@alepha/react";
import { Spotlight, type SpotlightActionData } from "@mantine/spotlight";
import { IconSearch } from "@tabler/icons-react";
import { type ReactNode, useMemo } from "react";

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
  const actions: SpotlightActionData[] = useMemo(
    () =>
      router.concretePages.map((page) => ({
        id: page.name,
        label: page.label ?? page.name,
        description: page.description,
        onClick: () => {
          if (page.staticName) {
            return router.go(page.staticName, { params: page.params });
          }
          return router.go(page.name);
        },
        leftSection: page.icon,
      })),
    [],
  );

  return (
    <Spotlight
      actions={actions}
      shortcut={shortcut}
      limit={10}
      searchProps={{
        leftSection: <IconSearch size={20} />,
        placeholder: searchPlaceholder,
      }}
      nothingFound={nothingFound}
    />
  );
};

export default Omnibar;
