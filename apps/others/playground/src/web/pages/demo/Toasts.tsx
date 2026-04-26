import { toast } from "sonner";
import { Button } from "@/web/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";

const Toasts = () => {
  return (
    <div className="flex flex-col gap-4 p-6">
      <header>
        <h1 className="text-lg font-semibold">Toasts</h1>
        <p className="text-muted-foreground text-sm">
          Exercise the sonner toast API.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs uppercase tracking-wider">
              Variants
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                toast.success("Saved", {
                  description: "Changes have been persisted.",
                })
              }
            >
              success
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                toast.error("Something broke", {
                  description: "Network request failed: 500 Internal.",
                })
              }
            >
              error
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                toast.info("Heads up", {
                  description: "A new version is available.",
                })
              }
            >
              info
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs uppercase tracking-wider">
              Stacked
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                toast.info("Step 1");
                setTimeout(() => toast.info("Step 2"), 400);
                setTimeout(() => toast.success("Step 3"), 800);
              }}
            >
              fire 3 in sequence
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Toasts;
