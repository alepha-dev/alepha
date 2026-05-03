import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useState } from "react";

const Dialogs = () => {
  const dialog = useDialog();
  const toast = useToast();
  const [lastResult, setLastResult] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Dialogs</h1>
          <p className="text-muted-foreground text-sm">
            Exercise <code>useDialog()</code> — confirm, alert, prompt, toast.
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
                const ok = await dialog.confirm({
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
                const ok = await dialog.confirm({
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

        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs uppercase tracking-wider">
              Alert
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await dialog.alert({
                  title: "Heads up",
                  description: "This is an informational message.",
                });
                setLastResult("alert: dismissed");
              }}
            >
              alert
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs uppercase tracking-wider">
              Prompt
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const value = await dialog.prompt({
                  title: "What's your name?",
                  label: "Name",
                  placeholder: "Ada",
                  defaultValue: "",
                });
                setLastResult(`prompt: ${JSON.stringify(value)}`);
              }}
            >
              prompt
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const value = await dialog.prompt({
                  title: "Email",
                  label: "Email address",
                  validate: (v) =>
                    /.+@.+\..+/.test(v) ? null : "Enter a valid email",
                });
                setLastResult(`validated prompt: ${JSON.stringify(value)}`);
              }}
            >
              prompt + validate
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs uppercase tracking-wider">
              Toast
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast("Plain toast")}
            >
              toast
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.success("Saved!")}
            >
              success
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.error("Something blew up")}
            >
              error
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                toast.promise(new Promise((r) => setTimeout(r, 1500)), {
                  loading: "Working...",
                  success: "Done",
                  error: "Failed",
                })
              }
            >
              promise
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dialogs;
