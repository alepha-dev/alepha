import { NestedView } from "alepha/react/router";
import FoliosSidebar from "./FoliosSidebar.tsx";

const FoliosLayout = () => {
  return (
    <div className="bg-background flex h-full min-h-0 flex-1">
      <FoliosSidebar />
      <main className="min-h-0 flex-1 overflow-auto">
        <NestedView />
      </main>
    </div>
  );
};

export default FoliosLayout;
