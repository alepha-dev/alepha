import { type Alepha, type Module } from "@alepha/core";
import { AlephaDateTime } from "@alepha/datetime";

export * from "./descriptors/$retry.ts";
export * from "./errors/RetryCancelError.ts";
export * from "./errors/RetryTimeoutError.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides robust retry mechanisms with exponential backoff, timeout handling, and cancellation support.
 * 
 * The retry module enables declarative retry logic using the `$retry` descriptor on class properties.
 * It offers configurable retry strategies, automatic error handling, exponential backoff algorithms,
 * and graceful degradation patterns for building resilient applications that handle transient failures.
 * 
 * **Key Features:**
 * - Declarative retry definition with `$retry` descriptor
 * - Exponential backoff with configurable parameters
 * - Maximum retry attempts and total timeout limits
 * - Automatic cancellation on application shutdown
 * - Custom error filtering and retry conditions
 * - Jitter support to prevent thundering herd effects
 * 
 * **Basic Usage:**
 * ```ts
 * import { Alepha, run } from "alepha";
 * import { AlephaRetry, $retry } from "alepha/retry";
 * 
 * class ApiService {
 *   // Retry API calls with exponential backoff
 *   fetchUser = $retry({
 *     maxAttempts: 3,
 *     baseDelay: "1s",
 *     maxDelay: "30s",
 *     backoffMultiplier: 2,
 *     handler: async (userId: string) => {
 *       const response = await fetch(`/api/users/${userId}`);
 *       if (!response.ok) {
 *         throw new Error(`HTTP ${response.status}: ${response.statusText}`);
 *       }
 *       return await response.json();
 *     },
 *   });
 * 
 *   // Database operations with retry
 *   saveData = $retry({
 *     maxAttempts: 5,
 *     baseDelay: "500ms",
 *     timeout: "10s",
 *     retryIf: (error) => {
 *       // Only retry on specific database errors
 *       return error.code === "CONNECTION_LOST" || error.code === "TIMEOUT";
 *     },
 *     handler: async (data: any) => {
 *       return await database.save(data);
 *     },
 *   });
 * }
 * 
 * const alepha = Alepha.create()
 *   .with(AlephaRetry)
 *   .with(ApiService);
 * 
 * run(alepha);
 * ```
 * 
 * **Advanced Retry Patterns:**
 * ```ts
 * class ResilientService {
 *   // File upload with progress and retry
 *   uploadFile = $retry({
 *     maxAttempts: 3,
 *     baseDelay: "2s",
 *     maxDelay: "60s",
 *     jitter: true,
 *     timeout: "5m",
 *     onRetry: (attempt, error, delay) => {
 *       console.log(`Upload attempt ${attempt} failed: ${error.message}, retrying in ${delay}ms`);
 *     },
 *     handler: async (file: File, options?: { onProgress?: (percent: number) => void }) => {
 *       return await uploadFileToServer(file, options);
 *     },
 *   });
 * 
 *   // External service integration
 *   processPayment = $retry({
 *     maxAttempts: 4,
 *     baseDelay: "1s",
 *     backoffMultiplier: 1.5,
 *     retryIf: (error) => {
 *       // Don't retry client errors, only server errors
 *       return error.status >= 500 || error.code === "NETWORK_ERROR";
 *     },
 *     onRetry: (attempt, error) => {
 *       if (attempt === 3) {
 *         // Switch to backup payment processor on final attempt
 *         this.switchToBackupProcessor();
 *       }
 *     },
 *     handler: async (paymentData: PaymentRequest) => {
 *       return await paymentProcessor.charge(paymentData);
 *     },
 *   });
 * 
 *   // Batch processing with retry
 *   processBatch = $retry({
 *     maxAttempts: 2,
 *     baseDelay: "5s",
 *     handler: async (items: any[]) => {
 *       const results = [];
 *       for (const item of items) {
 *         try {
 *           const result = await this.processItem(item);
 *           results.push(result);
 *         } catch (error) {
 *           // Individual item failures don't fail the whole batch
 *           results.push({ error: error.message, item });
 *         }
 *       }
 *       return results;
 *     },
 *   });
 * }
 * ```
 * 
 * **Circuit Breaker Pattern:**
 * ```ts
 * class CircuitBreakerService {
 *   private failureCount = 0;
 *   private isCircuitOpen = false;
 *   private lastFailureTime = 0;
 * 
 *   externalApiCall = $retry({
 *     maxAttempts: 3,
 *     baseDelay: "1s",
 *     retryIf: (error) => {
 *       // Circuit breaker logic
 *       if (this.isCircuitOpen) {
 *         const now = Date.now();
 *         if (now - this.lastFailureTime > 60000) { // 1 minute cooldown
 *           this.isCircuitOpen = false;
 *           this.failureCount = 0;
 *         } else {
 *           return false; // Don't retry when circuit is open
 *         }
 *       }
 *       return true;
 *     },
 *     onRetry: (attempt, error) => {
 *       this.failureCount++;
 *       this.lastFailureTime = Date.now();
 *       if (this.failureCount >= 5) {
 *         this.isCircuitOpen = true;
 *         console.log("Circuit breaker opened due to repeated failures");
 *       }
 *     },
 *     handler: async (data: any) => {
 *       if (this.isCircuitOpen) {
 *         throw new Error("Circuit breaker is open");
 *       }
 *       const result = await externalService.call(data);
 *       this.failureCount = 0; // Reset on success
 *       return result;
 *     },
 *   });
 * }
 * ```
 * 
 * **Usage in Application:**
 * ```ts
 * class UserService {
 *   api = new ApiService();
 * 
 *   async getUser(id: string) {
 *     try {
 *       // This will automatically retry on failure
 *       return await this.api.fetchUser(id);
 *     } catch (error) {
 *       console.error("Failed to fetch user after all retries:", error);
 *       throw error;
 *     }
 *   }
 * 
 *   async uploadUserAvatar(userId: string, file: File) {
 *     const service = new ResilientService();
 *     return await service.uploadFile(file, {
 *       onProgress: (percent) => {
 *         console.log(`Upload progress: ${percent}%`);
 *       },
 *     });
 *   }
 * }
 * ```
 * 
 * @see {@link $retry}
 * @module alepha.retry
 */
export class AlephaRetry implements Module {
	public readonly name = "alepha.retry";
	public readonly $services = (alepha: Alepha) =>
		alepha.with(AlephaDateTime);
}
