import {
  ToggleGroup,
  ToggleGroupItem,
} from "@alepha/ui/components/ui/toggle-group";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";

export const DevConfiguration = () => {
  const router = useRouter();
  const state = useRouterState();
  const tab = state.url.pathname.endsWith("/atoms") ? "atoms" : "env";

  const handleTabChange = (value: string) => {
    if (!value) return;
    router.push(value === "atoms" ? "/conf/atoms" : "/conf/env");
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-border flex border-b px-4 py-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={tab}
          onValueChange={handleTabChange}
        >
          <ToggleGroupItem value="env">Environment</ToggleGroupItem>
          <ToggleGroupItem value="atoms">Atoms</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <NestedView />
    </div>
  );
};

export default DevConfiguration;
