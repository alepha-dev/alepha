import { $hook, $inject, Alepha } from "@alepha/core";
import type { Toaster } from "@blueprintjs/core";
import { OverlayToaster } from "@blueprintjs/core";

class Toast {
	toaster?: Toaster;
	alepha = $inject(Alepha);

	configure = $hook({
		on: "configure",
		handler: async () => {
			if (!this.alepha.isBrowser()) {
				return;
			}

			this.toaster = await OverlayToaster.create({
				position: "top",
				className: "alepha-toast",
			});
		},
	});

	show(
		message: string,
		intent: "primary" | "success" | "warning" | "danger" = "primary",
	) {
		this.toaster?.show({
			message,
			intent,
			timeout: 3000,
		});
	}
}

export default Toast;
