import {
	$hook,
	$inject,
	Alepha,
	createDescriptor,
	Descriptor,
	KIND,
	run,
} from "@alepha/core";

class MyProvider {
	logs: string[] = [];
	alepha = $inject(Alepha);
	conf = $hook({
		on: "configure",
		handler: async () => {
			for (const log of this.logs) {
				this.alepha.log.trace(log);
			}
		},
	});
}

class Desc extends Descriptor {
	p = $inject(MyProvider);
	onInit(args) {
		this.p.logs.push(`configure ${this.config.propertyKey}`);
	}
}

const $desc = () => createDescriptor(Desc, {});
$desc[KIND] = Desc;

class App {
	h1 = $desc();
	h2 = $desc();
	h3 = $desc();
	h4 = $desc();
	h5 = $desc();
	h6 = $desc();
	h7 = $desc();
	h8 = $desc();
	h9 = $desc();
}

run(App, {
	env: {
		LOG_LEVEL: "trace",
	},
});
