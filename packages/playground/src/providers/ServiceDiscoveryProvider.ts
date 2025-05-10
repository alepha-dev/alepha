import { $hook, $inject } from "@alepha/core";
import { RedisProvider } from "@alepha/redis";
import { HttpClient, ServerProvider } from "@alepha/server";

export class ServiceDiscoveryProvider {
	// POC for Service Discovery

	redis = $inject(RedisProvider);
	httpClient = $inject(HttpClient);
	serverProvider = $inject(ServerProvider);

	onStart = $hook({
		name: "start",
		handler: async () => {
			const links = this.httpClient.links;
			if (!links) {
				return;
			}
			for (const link of links) {
				await this.redis.publisher.set(
					`alepha:link:${link.name}`,
					JSON.stringify({
						method: link.method,
						path: link.path,
						name: link.name,
						group: link.group,
						protected: link.protected,
						host: this.serverProvider.hostname,
					}),
					"EX",
					60 * 5,
				);
			}
		},
	});
}
