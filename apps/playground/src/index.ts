import { $inject, Alepha, run } from "@alepha/core";

const app = new Alepha({
	env: {
		LOG_LEVEL: "trace",
	},
});

class Prov1 {}
class Prov2 {}
class Prov3 {}

class Cmd1 {
	p1 = $inject(Prov1);
}
class Cmd2 {
	p2 = $inject(Prov2);
}
class Cmd3 {
	p2 = $inject(Prov2);
	p3 = $inject(Prov3);
}

class App {
	c1 = $inject(Cmd1);
	c2 = $inject(Cmd2);
	c3 = $inject(Cmd3);
}

app.with(App);
app.target = Cmd3;

app.on("ready", () => {
	console.log(app.graph());
});

run(app);
