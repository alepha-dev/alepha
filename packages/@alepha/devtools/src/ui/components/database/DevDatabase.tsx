import {
  ToggleGroup,
  ToggleGroupItem,
} from "@alepha/ui/components/ui/toggle-group";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";

export const DevDatabase = () => {
  const router = useRouter();
  const state = useRouterState();
  const tab = state.url.pathname.startsWith("/db/editor") ? "editor" : "erd";

  const handleTabChange = (value: string) => {
    if (!value) return;
    router.push(value === "editor" ? "/db/editor" : "/db/erd");
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
          <ToggleGroupItem value="erd">ERD</ToggleGroupItem>
          <ToggleGroupItem value="editor">Editor</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <NestedView />
    </div>
  );
};

export default DevDatabase;
