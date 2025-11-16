/**
 * SMS provider interface.
 *
 * All methods are asynchronous and return promises.
 */
export abstract class SmsProvider {
  /**
   * Send an SMS.
   *
   * @return Promise that resolves when the SMS is sent.
   */
  public abstract send(options: SmsSendOptions): Promise<void>;
}

export type SmsSendOptions = {
  to: string | string[];
  message: string;
};
