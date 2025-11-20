import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

const alepha = Alepha.create();
const dt = alepha.inject(DateTimeProvider);
const n = 100000;

benchDateTimeProviderIsoString();
benchDateTimeProviderNow();
benchDateTimeProviderNowMs();
benchNativeDateNow();
benchNativeDateToIsoString();

function benchDateTimeProviderNow() {
  const start = performance.now();
  for (let i = 0; i < n; i++) {
    dt.now();
  }
  const end = performance.now();
  console.log("DateTimeProviderNow - Time taken:", end - start, "ms");
}

function benchDateTimeProviderNowMs() {
  const start = performance.now();
  for (let i = 0; i < n; i++) {
    dt.nowMillis();
  }
  const end = performance.now();
  console.log("DateTimeProviderNowMs - Time taken:", end - start, "ms");
}

function benchDateTimeProviderIsoString() {
  const start = performance.now();
  for (let i = 0; i < n; i++) {
    dt.nowISOString();
  }
  const end = performance.now();
  console.log("DateTimeProviderIsoString - Time taken:", end - start, "ms");
}

function benchNativeDateNow() {
  const start = performance.now();
  for (let i = 0; i < n; i++) {
    Date.now();
  }
  const end = performance.now();
  console.log("NativeDateNow - Time taken:", end - start, "ms");
}

function benchNativeDateToIsoString() {
  const start = performance.now();
  for (let i = 0; i < n; i++) {
    new Date().toISOString();
  }
  const end = performance.now();
  console.log("NativeDateToIsoString - Time taken:", end - start, "ms");
}
