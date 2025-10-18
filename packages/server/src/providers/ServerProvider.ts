import { $inject, Alepha } from "@alepha/core";
import type { Route } from "@alepha/router";

export abstract class ServerProvider {
	protected readonly alepha = $inject(Alepha);

	public abstract get hostname(): string;

	protected isViteNotFound(
		url?: string,
		route?: Route,
		params?: Record<string, string>,
	): boolean {
		return (
			this.alepha.isViteDev() &&
			(!route || (!!params?.["*"] && `/${params?.["*"]}` === url)) &&
			(!route || !!url?.includes("."))
		);
	}
}
