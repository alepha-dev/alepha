import { $hook, $inject, Alepha } from "alepha";
import { toast } from "sonner";

export class Toaster {
  alepha = $inject(Alepha);

  configure = $hook({
    on: "configure",
    handler: async () => {
      if (!this.alepha.isBrowser()) {
        return;
      }
    },
  });

  show(
    message: string,
    intent: "primary" | "success" | "warning" | "danger" = "primary",
  ) {
    if (intent === "success") {
      toast.success(message);
    } else if (intent === "danger") {
      toast.error(message);
    } else if (intent === "warning") {
      toast.warning(message);
    } else {
      toast(message);
    }
  }
}
