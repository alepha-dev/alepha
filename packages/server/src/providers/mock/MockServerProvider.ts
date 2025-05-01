import type { ProxyDescriptorOptions } from "../../descriptors/$proxy";
import type { ServeDescriptorOptions } from "../../descriptors/$serve";
import { type RouteObject, ServerProvider } from "../ServerProvider";

export class MockServerProvider extends ServerProvider {
	public async route(route: RouteObject): Promise<void> {}

	public async serve(opts: ServeDescriptorOptions) {}

	public async proxy(opts: ProxyDescriptorOptions) {}

	public get hostname(): string {
		return "";
	}
}
