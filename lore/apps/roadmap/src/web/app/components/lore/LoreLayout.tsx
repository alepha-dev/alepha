import { NestedView } from "alepha/react/router";
import LoreSidebar from "./LoreSidebar.tsx";

const LoreLayout = () => {
  return (
    <div className="bg-background flex h-full min-h-0 flex-1">
      <LoreSidebar />
      <main className="min-h-0 flex-1 overflow-auto">
        <NestedView />
      </main>
    </div>
  );
};

export default LoreLayout;
