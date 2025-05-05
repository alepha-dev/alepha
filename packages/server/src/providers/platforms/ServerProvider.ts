import { NotImplementedError } from "@alepha/core";

export class ServerProvider {
	public get hostname(): string {
		throw new NotImplementedError(this.constructor.name);
	}
}
