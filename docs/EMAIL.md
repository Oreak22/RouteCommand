# Email infrastructure

Authentication verification and password reset messages are queued through BullMQ and sent through the `EmailProvider` interface. `NodemailerSmtpProvider` is the real provider; development Compose routes mail to Mailpit at `localhost:8025`. `ConsoleProvider` is restricted to `NODE_ENV=test`. The API verifies the selected provider during startup and `/health/ready` checks the email queue and worker.

The SMTP transport uses a bounded connection pool and stores lifecycle status in `email_logs`. `SENT` means the SMTP server accepted the message; SMTP alone cannot confirm inbox delivery. Each message has a deterministic dedupe key, also included as a stable message idempotency header. The worker checks `email_suppressions` before sending, suppresses 5xx permanent recipient rejections, enforces per-recipient and global hourly caps in Redis, and opens a short circuit breaker after repeated provider failures. Transient failures retry up to five times with exponential backoff. The database stores only a hash of the single-use action token; the token is sent inside the URL fragment, which browsers do not include in HTTP requests. Message bodies and secrets are not written to application logs.

Configure `EMAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, optional paired `SMTP_USER`/`SMTP_PASS`, `EMAIL_FROM`, and pool bounds `SMTP_MAX_CONNECTIONS` / `SMTP_MAX_MESSAGES` for deployment. `EMAIL_RECIPIENT_MAX_PER_HOUR`, `EMAIL_GLOBAL_MAX_PER_HOUR`, and `EMAIL_CIRCUIT_FAILURE_THRESHOLD` tune send protection. Production requires a non-local SMTP host, a sender address, TLS (implicit TLS via `SMTP_SECURE=true`, otherwise required STARTTLS), and rejects `EMAIL_PROVIDER=console`. The old `SMTP_PASSWORD` and `SMTP_FROM` names remain accepted as compatibility aliases.

## Sending-domain checklist

Before sending to real recipients:

1. Verify ownership of the sending domain with the SMTP relay and use a sender address on that domain.
2. Publish the SPF TXT record specified by the relay. Keep one SPF record and merge authorized senders into it.
3. Publish the relay's DKIM selector TXT/CNAME record and confirm outbound mail is signed.
4. Publish a DMARC TXT policy at `_dmarc.<domain>`. Start with reporting/monitoring (`p=none`), review aggregate reports, then tighten the policy when all legitimate senders pass alignment.
5. Send a message to an external mailbox and inspect `Authentication-Results` for SPF, DKIM, and DMARC alignment.
6. Set `EMAIL_FROM` to the verified sender. Use a monitored reply mailbox when replies are expected.

DNS values are provider-specific; copy them from the SMTP relay's domain setup page. Never copy a sample SPF/DKIM value from this document into DNS.

## Current notification coverage

Shipment status transitions to pickup, in transit, and arrival notify an active customer with a verified email. Customer-created requests notify active verified dispatchers and, when enabled, the closest eligible drivers with verified email; driver emails are invitations, not assignments. Assignment emails go to the assigned active, verified driver. Cancellation messages follow the actor role and include the prior shipment state. Recipient-specific dedupe uses the shipment transition event ID. Shipment update, dispatcher request, and driver invitation categories honor `/account/notifications`; account/security messages do not.

The shipment notification handlers are connected to after-commit events. Integration coverage verifies request notification deduplication, request/cancellation burst detection, impossible-travel events, account password-change and lockout messages, and brute-force admin alerts. Full coverage of every notification-matrix row and a manual Mailpit review were deferred when Phase 11A was closed by user direction. Real inbox delivery and DNS authentication remain unverified.
