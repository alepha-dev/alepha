import { NestedView } from "alepha/react/router";
import LoreSidebar from "./LoreSidebar.tsx";

const LoreLayout = () => {
  return (
    <div className="bg-background flex h-[calc(100vh-3.5rem)]">
      <LoreSidebar />
      <main className="flex-1 overflow-auto">
        <NestedView />
      </main>
    </div>
  );
};

export default LoreLayout;
