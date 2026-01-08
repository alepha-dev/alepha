import { t } from "alepha";
import { FakeProvider } from "../providers/FakeProvider.ts";

// Example showing how key names influence generated data
const fake = new FakeProvider({ seed: 12345 });

const userSchema = t.object({
  id: t.uuid(),
  firstName: t.text(), // Will generate a first name (e.g. "John")
  lastName: t.text(), // Will generate a last name (e.g. "Doe")
  email: t.text(), // Will generate an email (e.g. "john.doe@example.com")
  age: t.integer(), // Will generate age between 18-99
  phone: t.text(), // Will generate a phone number
  address: t.text(), // Will generate a street address
  city: t.text(), // Will generate a city name
  country: t.text(), // Will generate a country name
  company: t.text(), // Will generate a company name
  jobTitle: t.text(), // Will generate a job title
  username: t.text(), // Will generate a username
  website: t.text(), // Will generate a URL
  avatar: t.text(), // Will generate an avatar URL
  bio: t.text(), // Will generate a short bio
});

const fakeUser = fake.generate(userSchema);

console.log("Generated user with key name intelligence:");
console.log(JSON.stringify(fakeUser, null, 2));

// Example with explicit formats (key names are ignored when format is set)
const explicitSchema = t.object({
  id: t.uuid(), // format: uuid - generates UUID
  email: t.email(), // format: email - generates email
  createdAt: t.string({ format: "date-time" }), // format: date-time
});

const explicitData = fake.generate(explicitSchema);

console.log("\nGenerated data with explicit formats:");
console.log(JSON.stringify(explicitData, null, 2));
