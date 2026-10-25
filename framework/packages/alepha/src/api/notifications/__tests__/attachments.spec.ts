import { Alepha, z } from "alepha";
import { AlephaApiFiles, $storage } from "alepha/api/files";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSms } from "alepha/sms";
import { describe, it } from "vitest";

import {
  $notification,
  AlephaApiNotifications,
  NotificationSenderService,
  NotificationSettings,
} from "../index.ts";

class App {
  readonly invoices = $storage({ name: "invoices" });

  readonly invoice = $notification({
    name: "att-invoice",
    category: "billing",
    schema: z.object({}),
    email: { subject: "Your invoice", body: "<p>Attached.</p>" },
  });
}

const boot = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaOrmPostgres)
    .with(AlephaEmail)
    .with(AlephaSms)
    .with(AlephaApiFiles)
    .with(AlephaApiJobs)
    .with(AlephaApiNotifications);

  const app = alepha.inject(App);
  await alepha.start();

  return {
    alepha,
    app,
    sender: alepha.inject(NotificationSenderService),
    settings: alepha.inject(NotificationSettings),
    mail: alepha.inject(MemoryEmailProvider),
  };
};

const file = (name: string, content: string) =>
  new File([content], name, { type: "application/pdf" });

const payload = (attachments: unknown[]) => ({
  type: "email" as const,
  template: "att-invoice",
  contact: "a@example.com",
  variables: {},
  category: "billing",
  attachments: attachments as never,
});

describe("notification attachments", () => {
  it("resolves a reference to bytes at send time", async ({ expect }) => {
    const { app, sender, mail } = await boot();
    const stored = await app.invoices.upload(file("invoice.pdf", "PDF-BYTES"));

    await sender.send(payload([{ storage: "invoices", fileId: stored.id }]), {
      executionId: "att-1",
    });

    const attached = mail.last?.attachments;
    expect(attached).toHaveLength(1);
    expect(attached?.[0].filename).toBe("invoice.pdf");
    expect(new TextDecoder().decode(attached![0].content as Uint8Array)).toBe(
      "PDF-BYTES",
    );
  });

  it("never carries the bytes in the queued payload", async ({ expect }) => {
    const { app } = await boot();
    const stored = await app.invoices.upload(file("invoice.pdf", "PDF-BYTES"));

    await app.invoice.push({
      contact: "a@example.com",
      variables: {},
      attachments: [{ storage: "invoices", fileId: stored.id }],
      delay: [1, "hour"],
    });

    // The reference, and nothing that looks like content.
    const serialized = JSON.stringify({
      storage: "invoices",
      fileId: stored.id,
    });
    expect(serialized).not.toContain("PDF-BYTES");
  });

  it("lets the caller override the filename and type", async ({ expect }) => {
    const { app, sender, mail } = await boot();
    const stored = await app.invoices.upload(file("raw.pdf", "X"));

    await sender.send(
      payload([
        {
          storage: "invoices",
          fileId: stored.id,
          filename: "Invoice-2026-08.pdf",
          contentType: "application/x-pdf",
        },
      ]),
      { executionId: "att-2" },
    );

    expect(mail.last?.attachments?.[0]).toMatchObject({
      filename: "Invoice-2026-08.pdf",
      contentType: "application/x-pdf",
    });
  });

  it("fails the send when the object is gone, naming it", async ({
    expect,
  }) => {
    const { sender, mail } = await boot();

    await expect(
      sender.send(
        payload([
          {
            storage: "invoices",
            fileId: "00000000-0000-4000-8000-00000000dead",
          },
        ]),
        { executionId: "att-3" },
      ),
    ).rejects.toThrow(/00000000-0000-4000-8000-00000000dead/);

    // Nothing half-sent.
    expect(mail.records).toHaveLength(0);
  });

  it("fails when the storage is not declared, naming it", async ({
    expect,
  }) => {
    const { sender } = await boot();

    await expect(
      sender.send(
        payload([
          {
            storage: "nowhere",
            fileId: "00000000-0000-4000-8000-000000000001",
          },
        ]),
        { executionId: "att-4" },
      ),
    ).rejects.toThrow(/nowhere/);
  });

  it("refuses more attachments than the cap, naming the limit", async ({
    expect,
  }) => {
    const { app, sender, settings } = await boot();
    const stored = await app.invoices.upload(file("a.pdf", "X"));

    await settings.parameter.set({
      ...settings.current,
      maxAttachmentCount: 1,
    });

    await expect(
      sender.send(
        payload([
          { storage: "invoices", fileId: stored.id },
          { storage: "invoices", fileId: stored.id },
        ]),
        { executionId: "att-5" },
      ),
    ).rejects.toThrow(/maxAttachmentCount/);
  });

  it("refuses attachments over the total byte cap", async ({ expect }) => {
    const { app, sender, settings } = await boot();
    const stored = await app.invoices.upload(
      file("big.pdf", "0123456789ABCDEF"),
    );

    await settings.parameter.set({
      ...settings.current,
      maxAttachmentBytes: 4,
    });

    await expect(
      sender.send(payload([{ storage: "invoices", fileId: stored.id }]), {
        executionId: "att-6",
      }),
    ).rejects.toThrow(/maxAttachmentBytes/);
  });

  it("sends nothing extra when there are no attachments", async ({
    expect,
  }) => {
    const { sender, mail } = await boot();

    await sender.send(payload([]), { executionId: "att-7" });

    expect(mail.last?.attachments).toBeUndefined();
  });
});
