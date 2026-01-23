import { Alepha, t } from "alepha";

const alepha = Alepha.create();

const userSchema = t.object({
  id: t.int32(),
  name: t.text(),
  email: t.text(),
  isActive: t.boolean(),
  createdAt: t.datetime(),
  updatedAt: t.datetime(),
  role: t.text(),
  phoneNumber: t.optional(t.text()),
  address: t.optional(
    t.object({
      street: t.text(),
      city: t.text(),
      postalCode: t.text(),
      country: t.text(),
    }),
  ),
  preferences: t.optional(
    t.object({
      newsletter: t.boolean(),
      notifications: t.boolean(),
    }),
  ),
  tags: t.array(t.text()),
  socialProfiles: t.array(
    t.object({
      platform: t.text(),
      username: t.text(),
    }),
  ),
});

const john = {
  id: 1,
  name: "John Doe",
  email: "john@gmail.com",
  isActive: true,
  createdAt: "2023-01-01T00:00:00Z",
  updatedAt: "2023-01-10T00:00:00Z",
  role: "admin",
  phoneNumber: "+1234567890",
  address: {
    street: "123 Main St",
    city: "Anytown",
    postalCode: "12345",
    country: "USA",
  },
  preferences: {
    newsletter: true,
    notifications: false,
  },
  tags: ["premium", "beta-tester"],
  socialProfiles: [
    { platform: "twitter", username: "johndoe" },
    { platform: "github", username: "johndoe" },
  ],
};

const N = 50000;
const WARMUP = 5000;

// Warmup phase - let JIT optimize
for (let i = 0; i < WARMUP; i++) {
  alepha.codec.encode(userSchema, john, { as: "string", validation: false });
  alepha.codec.encode(userSchema, john, {
    encoder: "keyless",
    as: "string",
    validation: false,
  });
}

// Benchmark encode
console.time("encode-standard");
for (let i = 0; i < N; i++) {
  alepha.codec.encode(userSchema, john, { as: "string", validation: false });
}
console.timeEnd("encode-standard");

console.time("encode-keyless");
for (let i = 0; i < N; i++) {
  alepha.codec.encode(userSchema, john, {
    encoder: "keyless",
    as: "string",
    validation: false,
  });
}
console.timeEnd("encode-keyless");

const a = alepha.codec.encode(userSchema, john, {
  as: "string",
  validation: false,
});
const b = alepha.codec.encode(userSchema, john, {
  encoder: "keyless",
  as: "string",
  validation: false,
});

console.log("Standard size:", a.length);
console.log("Keyless size:", b.length);

// Warmup decode
for (let i = 0; i < WARMUP; i++) {
  alepha.codec.decode(userSchema, a, { validation: false });
  alepha.codec.decode(userSchema, b, { encoder: "keyless", validation: false });
}

// Benchmark decode
console.time("decode-standard");
for (let i = 0; i < N; i++) {
  alepha.codec.decode(userSchema, a, { validation: false });
}
console.timeEnd("decode-standard");

console.time("decode-keyless");
for (let i = 0; i < N; i++) {
  alepha.codec.decode(userSchema, b, { encoder: "keyless", validation: false });
}
console.timeEnd("decode-keyless");
