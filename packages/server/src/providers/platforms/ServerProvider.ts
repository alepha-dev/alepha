import { NotImplementedError } from "@alepha/core";

export class ServerProvider {
	constructor() {
		throw new NotImplementedError(this.constructor.name);
	}

	public get hostname(): string {
		throw new NotImplementedError(this.constructor.name);
	}
}
