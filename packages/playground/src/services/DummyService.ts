import { $logger } from "@alepha/core";

export class DummyService {
	log = $logger();

	async printLog() {
		this.log.info("Hello from DummyService");
	}
}
