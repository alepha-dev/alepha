import { z } from "alepha";
import { FakeProvider } from "../providers/FakeProvider.ts";

// Example showing how key names influence generated data
const fake = new FakeProvider();

const userSchema = z.object({
  id: z.uuid(),
  firstName: z.text(), // Will generate a first name (e.g. "John")
  lastName: z.text(), // Will generate a last name (e.g. "Doe")
  email: z.text(), // Will generate an email (e.g. "john.doe@example.com")
  age: z.integer(), // Will generate age between 18-99
  phone: z.text(), // Will generate a phone number
  address: z.text(), // Will generate a street address
  city: z.text(), // Will generate a city name
  country: z.text(), // Will generate a country name
  company: z.text(), // Will generate a company name
  jobTitle: z.text(), // Will generate a job title
  username: z.text(), // Will generate a username
  website: z.text(), // Will generate a URL
  avatar: z.text(), // Will generate an avatar URL
  bio: z.text(), // Will generate a short bio
});

const fakeUser = fake.generate(userSchema);

console.log("Generated user with key name intelligence:");
console.log(JSON.stringify(fakeUser, null, 2));

// Example with explicit formats (key names are ignored when format is set)
const explicitSchema = z.object({
  id: z.uuid(), // format: uuid - generates UUID
  email: z.email(), // format: email - generates email
  createdAt: z.string().meta({ format: "date-time" }), // format: date-time
});

const explicitData = fake.generate(explicitSchema);

console.log("\nGenerated data with explicit formats:");
console.log(JSON.stringify(explicitData, null, 2));
