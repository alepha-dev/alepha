import { $inject, Alepha, z } from "alepha";

import { AlephaFake, FakeProvider } from "../index.ts";

// Example showing how to use the AlephaFake module
class MyApp {
  constructor(protected fake = $inject(FakeProvider)) {}

  async seedDatabase() {
    // Define your schema
    const userSchema = z.object({
      id: z.uuid(),
      firstName: z.text(),
      lastName: z.text(),
      email: z.email(),
      age: z.integer().min(18).max(99),
      createdAt: z.string().meta({ format: "date-time" }),
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
