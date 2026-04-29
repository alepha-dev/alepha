import { useAuth } from "alepha/react/auth";
import { NestedView } from "alepha/react/router";
import { User } from "lucide-react";
import MeLayoutMenu from "./MeLayoutMenu.tsx";

const MeLayout = () => {
  const auth = useAuth();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 overflow-auto p-4">
      {/* Compact header */}
      <div className="flex items-center gap-4 rounded-md border border-border bg-card p-4">
        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
          {auth.user?.picture ? (
            <img
              src={`/api/files/${auth.user.picture}`}
              alt="avatar"
              className="size-full object-cover"
            />
          ) : (
            <User className="size-5" />
          )}
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold">
            {auth.user?.username || "Anonymous"}
          </span>
          <span className="text-xs text-muted-foreground">
            {auth.user?.email}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-4 overflow-auto md:flex-row">
        <div className="md:w-48 md:min-w-48">
          <MeLayoutMenu />
        </div>
        <div className="flex flex-1 overflow-auto">
          <NestedView />
        </div>
      </div>
    </div>
  );
};

export default MeLayout;
