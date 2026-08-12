import { useRouter } from "alepha/react/router";
import { ArrowLeft, LayoutDashboard } from "lucide-react";

/**
 * Lore's admin sidebar brand: a back-arrow to `home` beside the
 * "Admin Panel" title. Recovered verbatim from the deleted
 * `AppAdminLayout` — this is why it is its own component rather than
 * inline JSX in `adminChrome.tsx`: `router.push("home")` needs a router,
 * and hooks have no place in a plain options object.
 */
export const AdminBrand = () => {
  const router = useRouter<any>();

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center">
      <button
        type="button"
        onClick={() => router.push("home")}
        aria-label="Back to home"
        className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
      >
        <ArrowLeft className="size-4" />
      </button>
      <LayoutDashboard className="size-4 shrink-0 group-data-[collapsible=icon]:hidden" />
      <span className="text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
        Admin Panel
      </span>
    </div>
  );
};
