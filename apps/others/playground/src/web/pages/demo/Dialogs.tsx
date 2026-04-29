import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useConfirm } from "@alepha/ui/components/use-confirm";
import { useState } from "react";
import { toast } from "sonner";

const Dialogs = () => {
  const confirm = useConfirm();
  const [lastResult, setLastResult] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Dialogs</h1>
          <p className="text-muted-foreground text-sm">
            Exercise confirm dialogs via <code>useConfirm</code>.
          </p>
        </div>
        {lastResult && (
          <p className="text-muted-foreground text-xs">
            Last result:{" "}
            <span className="text-foreground font-mono">{lastResult}</span>
          </p>
        )}
      </header>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs uppercase tracking-wider">
              Confirm
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const ok = await confirm({
                  title: "Continue?",
                  description: "Are you sure you want to proceed?",
                });
                setLastResult(`confirm: ${ok}`);
              }}
            >
              confirm
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const ok = await confirm({
                  title: "Delete forever?",
                  description: "This cannot be undone.",
                  confirmLabel: "Delete",
                  cancelLabel: "Keep",
                  destructive: true,
                });
                setLastResult(`destructive: ${ok}`);
                if (ok) toast.success("Deleted");
              }}
            >
              destructive
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dialogs;
