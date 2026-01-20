import { randomBytes } from "node:crypto";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { CryptoProvider } from "alepha/security";
import {
  type OAuthClientEntity,
  oauthClients,
} from "../entities/oauthClients.ts";

/**
 * Service for managing MCP OAuth2 clients.
 *
 * Provides CRUD operations for OAuth clients and credential validation.
 */
export class OAuthClientService {
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly clients = $repository(oauthClients);

  /**
   * Generate a new client secret.
   * Returns a cryptographically secure random string.
   */
  public generateClientSecret(): string {
    return randomBytes(32).toString("base64url");
  }

  /**
   * Generate a new client ID.
   * Returns a cryptographically secure random string.
   */
  public generateClientId(): string {
    return `mcp_${randomBytes(16).toString("hex")}`;
  }

  /**
   * Create a new OAuth client.
   *
   * @returns The created client and the plaintext secret (only returned once).
   */
  public async createClient(options: {
    name: string;
    description?: string;
    scopes?: string[];
    ownerId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{
    client: OAuthClientEntity;
    clientSecret: string;
  }> {
    const clientId = this.generateClientId();
    const clientSecret = this.generateClientSecret();
    const clientSecretHash = await this.crypto.hashPassword(clientSecret);

    const client = await this.clients.create({
      clientId,
      clientSecretHash,
      name: options.name,
      description: options.description,
      scopes: options.scopes ?? [],
      ownerId: options.ownerId,
      metadata: options.metadata,
    });

    return {
      client,
      clientSecret,
    };
  }

  /**
   * Find a client by its clientId.
   */
  public async findByClientId(
    clientId: string,
  ): Promise<OAuthClientEntity | undefined> {
    const results = await this.clients.findMany({
      where: { clientId: { eq: clientId } },
      limit: 1,
    });
    return results[0];
  }

  /**
   * Validate client credentials.
   *
   * @returns The client if valid, undefined otherwise.
   */
  public async validateCredentials(
    clientId: string,
    clientSecret: string,
  ): Promise<OAuthClientEntity | undefined> {
    const client = await this.findByClientId(clientId);

    if (!client) {
      // Timing attack mitigation: still do a hash comparison
      await this.crypto.verifyPassword(clientSecret, "dummy:dummy");
      return undefined;
    }

    if (!client.enabled) {
      return undefined;
    }

    const isValid = await this.crypto.verifyPassword(
      clientSecret,
      client.clientSecretHash,
    );

    return isValid ? client : undefined;
  }

  /**
   * Update a client's details.
   */
  public async updateClient(
    id: string,
    updates: {
      name?: string;
      description?: string;
      scopes?: string[];
      enabled?: boolean;
      metadata?: Record<string, unknown>;
    },
  ): Promise<OAuthClientEntity> {
    return this.clients.updateById(id, updates);
  }

  /**
   * Rotate a client's secret.
   *
   * @returns The new plaintext secret (only returned once).
   */
  public async rotateSecret(id: string): Promise<{
    client: OAuthClientEntity;
    clientSecret: string;
  }> {
    const clientSecret = this.generateClientSecret();
    const clientSecretHash = await this.crypto.hashPassword(clientSecret);

    const client = await this.clients.updateById(id, { clientSecretHash });

    return {
      client,
      clientSecret,
    };
  }

  /**
   * Delete a client.
   */
  public async deleteClient(id: string): Promise<void> {
    await this.clients.deleteById(id);
  }

  /**
   * List all clients (optionally filtered by owner).
   */
  public async listClients(options?: {
    ownerId?: string;
    enabled?: boolean;
  }): Promise<OAuthClientEntity[]> {
    const where: Record<string, { eq: unknown }> = {};

    if (options?.ownerId) {
      where.ownerId = { eq: options.ownerId };
    }
    if (options?.enabled !== undefined) {
      where.enabled = { eq: options.enabled };
    }

    return this.clients.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
    });
  }

  /**
   * Check if a client has a specific scope.
   */
  public hasScope(client: OAuthClientEntity, scope: string): boolean {
    // Check for exact match
    if (client.scopes.includes(scope)) {
      return true;
    }

    // Check for wildcard patterns
    for (const clientScope of client.scopes) {
      if (clientScope === "*") {
        return true;
      }

      if (clientScope.endsWith(":*")) {
        const prefix = clientScope.slice(0, -1); // Remove trailing *
        if (scope.startsWith(prefix)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if a client has all required scopes.
   */
  public hasScopes(client: OAuthClientEntity, scopes: string[]): boolean {
    return scopes.every((scope) => this.hasScope(client, scope));
  }
}
