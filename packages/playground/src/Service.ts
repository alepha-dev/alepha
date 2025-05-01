import { $inject, $logger } from "@alepha/core";
import { HelloRepository } from "./HelloRepository.ts";

export class Service {
	log = $logger();

	hr = $inject(HelloRepository);

	async printLog() {
		this.log.info(`Hello from ${await this.hr.getHello()}`);
	}
}
