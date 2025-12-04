import { t } from "alepha";
import { $notification } from "alepha/api/notifications";

export class BookingNotifications {
  /**
   * Email sent to passengers when their booking is confirmed.
   */
  public readonly bookingConfirmation = $notification({
    category: "booking",
    description:
      "Email sent to passengers when their train booking is confirmed.",
    critical: true,
    sensitive: false,
    email: {
      subject: "Your Train Booking is Confirmed",
      body: (it) => `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); padding: 32px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Booking Confirmed!</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0;">Your train journey is all set</p>
          </div>

          <div style="padding: 32px; background: #f8fafc;">
            <p style="margin: 0 0 24px 0; font-size: 16px;">
              Hi <strong>${it.passengerFirstName}</strong>,
            </p>

            <p style="margin: 0 0 24px 0; color: #64748b;">
              Thank you for booking with us! Your train ticket has been confirmed. Please find your booking details below.
            </p>

            <div style="background: white; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #e2e8f0;">
              <div style="text-align: center; margin-bottom: 24px;">
                <span style="font-size: 14px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">Booking Reference</span>
                <div style="font-size: 32px; font-weight: bold; font-family: monospace; color: #1e40af; margin-top: 8px; letter-spacing: 4px;">
                  ${it.reference}
                </div>
              </div>

              <div style="border-top: 2px dashed #e2e8f0; margin: 24px 0;"></div>

              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 12px 0; vertical-align: top;">
                    <div style="font-size: 12px; color: #64748b; text-transform: uppercase;">From</div>
                    <div style="font-size: 18px; font-weight: 600; color: #1e293b;">${it.departureStation}</div>
                    <div style="font-size: 24px; font-weight: bold; color: #2563eb;">${it.departureTime}</div>
                  </td>
                  <td style="padding: 12px; text-align: center; vertical-align: middle;">
                    <div style="color: #94a3b8;">→</div>
                  </td>
                  <td style="padding: 12px 0; vertical-align: top; text-align: right;">
                    <div style="font-size: 12px; color: #64748b; text-transform: uppercase;">To</div>
                    <div style="font-size: 18px; font-weight: 600; color: #1e293b;">${it.arrivalStation}</div>
                    <div style="font-size: 24px; font-weight: bold; color: #2563eb;">${it.arrivalTime}</div>
                  </td>
                </tr>
              </table>

              <div style="border-top: 2px dashed #e2e8f0; margin: 24px 0;"></div>

              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0;">
                    <span style="color: #64748b;">Travel Date</span>
                  </td>
                  <td style="padding: 8px 0; text-align: right; font-weight: 600;">
                    ${it.travelDate}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;">
                    <span style="color: #64748b;">Train</span>
                  </td>
                  <td style="padding: 8px 0; text-align: right; font-weight: 600;">
                    ${it.trainNumber} (${it.trainType})
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;">
                    <span style="color: #64748b;">Passengers</span>
                  </td>
                  <td style="padding: 8px 0; text-align: right; font-weight: 600;">
                    ${it.passengerCount}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;">
                    <span style="color: #64748b;">Seats</span>
                  </td>
                  <td style="padding: 8px 0; text-align: right; font-weight: 600;">
                    ${it.seats}
                  </td>
                </tr>
              </table>

              <div style="border-top: 2px dashed #e2e8f0; margin: 24px 0;"></div>

              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0;">
                    <span style="font-size: 18px; font-weight: 600;">Total Paid</span>
                  </td>
                  <td style="padding: 8px 0; text-align: right;">
                    <span style="font-size: 24px; font-weight: bold; color: #059669;">€${it.totalPrice}</span>
                  </td>
                </tr>
              </table>
            </div>

            <div style="background: #fef3c7; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
              <p style="margin: 0; color: #92400e; font-size: 14px;">
                <strong>Important:</strong> Please arrive at ${it.departureStation} at least 30 minutes before departure.
                Have your booking reference ready for ticket validation.
              </p>
            </div>

            <div style="text-align: center; margin-top: 32px;">
              <p style="color: #64748b; font-size: 14px; margin: 0;">
                Need help? Contact us at <a href="mailto:support@trainbooking.com" style="color: #2563eb;">support@trainbooking.com</a>
              </p>
            </div>
          </div>

          <div style="background: #1e293b; padding: 24px; text-align: center;">
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">
              This is an automated email. Please do not reply directly to this message.
            </p>
          </div>
        </div>
      `,
    },
    schema: t.object({
      passengerFirstName: t.text(),
      passengerLastName: t.text(),
      passengerEmail: t.email(),
      reference: t.text(),
      departureStation: t.text(),
      arrivalStation: t.text(),
      departureTime: t.text(),
      arrivalTime: t.text(),
      travelDate: t.text(),
      trainNumber: t.text(),
      trainType: t.text(),
      passengerCount: t.integer(),
      seats: t.text(),
      totalPrice: t.text(),
    }),
  });

  /**
   * Email sent to passengers when their booking is cancelled.
   */
  public readonly bookingCancellation = $notification({
    category: "booking",
    description: "Email sent to passengers when their booking is cancelled.",
    critical: true,
    sensitive: false,
    email: {
      subject: "Your Train Booking has been Cancelled",
      body: (it) => `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #dc2626; padding: 32px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Booking Cancelled</h1>
          </div>

          <div style="padding: 32px; background: #f8fafc;">
            <p style="margin: 0 0 24px 0; font-size: 16px;">
              Hi <strong>${it.passengerFirstName}</strong>,
            </p>

            <p style="margin: 0 0 24px 0; color: #64748b;">
              Your booking <strong style="font-family: monospace;">${it.reference}</strong> has been cancelled.
            </p>

            <div style="background: white; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #e2e8f0;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0;">
                    <span style="color: #64748b;">Route</span>
                  </td>
                  <td style="padding: 8px 0; text-align: right; font-weight: 600;">
                    ${it.departureStation} → ${it.arrivalStation}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;">
                    <span style="color: #64748b;">Travel Date</span>
                  </td>
                  <td style="padding: 8px 0; text-align: right; font-weight: 600;">
                    ${it.travelDate}
                  </td>
                </tr>
              </table>
            </div>

            <p style="color: #64748b; font-size: 14px;">
              If you have any questions about this cancellation, please contact our support team.
            </p>

            <div style="text-align: center; margin-top: 32px;">
              <p style="color: #64748b; font-size: 14px; margin: 0;">
                Need help? Contact us at <a href="mailto:support@trainbooking.com" style="color: #2563eb;">support@trainbooking.com</a>
              </p>
            </div>
          </div>
        </div>
      `,
    },
    schema: t.object({
      passengerFirstName: t.text(),
      passengerEmail: t.email(),
      reference: t.text(),
      departureStation: t.text(),
      arrivalStation: t.text(),
      travelDate: t.text(),
    }),
  });
}
