import { $inject, Alepha, t } from "alepha";
import { AlephaFake, FakeProvider } from "../../src/fake/index.ts";

// Example showing how to use the AlephaFake module
class MyApp {
  constructor(private fake = $inject(FakeProvider)) {}

  async seedDatabase() {
    // Define your schema
    const userSchema = t.object({
      id: t.uuid(),
      firstName: t.text(),
      lastName: t.text(),
      email: t.email(),
      age: t.integer({ minimum: 18, maximum: 99 }),
      createdAt: t.string({ format: "date-time" }),
    });

    // Generate multiple fake users
    return this.fake.generateMany(userSchema, 10);
  }
}

// Create Alepha instance with the fake module
const alepha = Alepha.create().with(AlephaFake);

const app = alepha.inject(MyApp);

// Seed the database
await alepha.start();
await app.seedDatabase();
await alepha.stop();
