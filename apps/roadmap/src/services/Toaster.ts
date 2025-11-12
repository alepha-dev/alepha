import { $hook, $inject, Alepha } from "@alepha/core";
import { notifications } from "@mantine/notifications";

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
    const color =
      intent === "primary" ? "blue" : intent === "danger" ? "red" : intent;
    notifications.show({
      message,
      color,
      autoClose: 3000,
    });
  }
}
