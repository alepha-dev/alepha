import { $hook } from "@alepha/core";

export class BucketDescriptorProvider {
	public readonly onConfigure = $hook({
		name: "configure",
		handler: () => {
			// ...
		},
	});
}
