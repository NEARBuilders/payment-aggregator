import { Context, Effect, Layer } from "every-plugin/effect";
import { Resend } from "resend";

interface EmailNotification {
  to: string[];
  subject: string;
  body: string;
  replyTo?: string;
}

export class EmailService extends Context.Tag("EmailService")<
  EmailService,
  {
    readonly sendNotification: (notification: EmailNotification) => Effect.Effect<void, Error>;
  }
>() {}

export const EmailServiceLive = (config: { fromEmail: string; resendApiKey?: string }) =>
  Layer.effect(
    EmailService,
    Effect.gen(function* () {
      const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;

      return {
        sendNotification: (notification) =>
          Effect.tryPromise({
            try: async () => {
              if (resend) {
                const { data, error } = await resend.emails.send({
                  from: config.fromEmail,
                  to: notification.to,
                  subject: notification.subject,
                  text: notification.body,
                  ...(notification.replyTo ? { replyTo: notification.replyTo } : {}),
                });

                if (error) {
                  throw new Error(`Resend API error: ${error.message}`);
                }

                console.log(
                  `[EmailService] Sent notification to: ${notification.to.join(", ")} via Resend (id: ${data?.id})`,
                );
              } else {
                console.log(
                  `[EmailService] No Resend API key configured; logging notification:\n` +
                    `To: ${notification.to.join(", ")}\n` +
                    `From: ${config.fromEmail}\n` +
                    `Subject: ${notification.subject}\n` +
                    (notification.replyTo ? `Reply-To: ${notification.replyTo}\n` : "") +
                    `\n${notification.body}`,
                );
              }
            },
            catch: (error) => new Error(`Failed to send email notification: ${error}`),
          }),
      };
    }),
  );
