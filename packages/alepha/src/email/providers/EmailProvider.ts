/**
 * Email provider interface.
 *
 * All methods are asynchronous and return promises.
 */
export abstract class EmailProvider {
  /**
   * Send an email.
   *
   * @return Promise that resolves when the email is sent.
   */
  public abstract send(options: EmailSendOptions): Promise<void>;
}

export type EmailSendOptions = {
  to: string | string[];
  subject: string;
  body: string;
};
