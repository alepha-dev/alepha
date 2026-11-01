/**
 * Core Web Vitals collection, with nothing else in it: no container, no React,
 * no import at all. A bundle that wants the numbers and nothing of the
 * framework can import this alone.
 *
 * In an Alepha app, reach for `ReactVitalsProvider` in `alepha/react/vitals`.
 *
 * @module alepha.vitals
 */
export * from "./WebVitalsCollector.ts";
