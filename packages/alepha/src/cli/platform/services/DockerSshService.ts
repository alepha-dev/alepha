import { $inject, AlephaError } from "alepha";
import { ShellProvider } from "alepha/system";

/**
 * Wraps SSH and SCP operations for remote Docker deployments.
 */
export class DockerSshService {
  protected readonly shell = $inject(ShellProvider);

  /**
   * Validate an IP address or hostname to prevent shell injection.
   */
  protected validateHost(ip: string): void {
    // Allow IPv4, IPv6, and hostnames (alphanumeric, dots, hyphens, colons)
    if (!/^[a-zA-Z0-9.:_-]+$/.test(ip)) {
      throw new AlephaError(`Invalid host: ${ip}`);
    }
  }

  /**
   * Validate a file path to prevent shell injection.
   */
  protected validatePath(path: string): void {
    // Reject shell metacharacters
    if (/[;&|`$(){}'"\\!#~<>*?[\]\n\r]/.test(path)) {
      throw new AlephaError(`Invalid path: ${path}`);
    }
  }

  /**
   * Verify SSH connectivity to the remote host.
   */
  async checkConnection(ip: string): Promise<void> {
    this.validateHost(ip);
    await this.shell.run(`ssh root@${ip} echo ok`);
  }

  /**
   * Execute a command on the remote host via SSH.
   */
  async exec(ip: string, command: string): Promise<string> {
    this.validateHost(ip);
    // Escape single quotes in the command and wrap in single quotes
    const escaped = command.replace(/'/g, "'\\''");
    return this.shell.run(`ssh root@${ip} '${escaped}'`, { capture: true });
  }

  /**
   * Upload a file to the remote host via SCP.
   */
  async upload(
    ip: string,
    localPath: string,
    remotePath: string,
  ): Promise<void> {
    this.validateHost(ip);
    this.validatePath(localPath);
    this.validatePath(remotePath);
    await this.shell.run(`scp ${localPath} root@${ip}:${remotePath}`);
  }
}
