import { $inject } from "alepha";
import { ShellProvider } from "alepha/system";

/**
 * Wraps SSH and SCP operations for remote Docker deployments.
 */
export class DockerSshService {
  protected readonly shell = $inject(ShellProvider);

  /**
   * Verify SSH connectivity to the remote host.
   */
  async checkConnection(ip: string): Promise<void> {
    await this.shell.run(`ssh root@${ip} echo ok`);
  }

  /**
   * Execute a command on the remote host via SSH.
   */
  async exec(ip: string, command: string): Promise<string> {
    return this.shell.run(`ssh root@${ip} "${command}"`, { capture: true });
  }

  /**
   * Upload a file to the remote host via SCP.
   */
  async upload(
    ip: string,
    localPath: string,
    remotePath: string,
  ): Promise<void> {
    await this.shell.run(`scp ${localPath} root@${ip}:${remotePath}`);
  }
}
