# Scheduled Runs

LibreChat supports per-user scheduled runs for both agent executions and model prompts.

Users can manage scheduled runs from **Settings → Data → Scheduled runs**.

## What scheduled runs support

- cron-based scheduling with timezone support
- agent runs and direct model prompts
- manual run-now execution
- email notifications
- SMS notifications through Twilio
- SMS notifications through carrier gateway email addresses
- browser push notifications

## Notification setup

### Email

Scheduled run email delivery uses the existing LibreChat email configuration.

Configure either:

- `EMAIL_*` for SMTP, or
- `MAILGUN_*` for Mailgun

The scheduled run UI lets each user choose the destination email address used for notifications.

### Twilio SMS

To enable direct SMS delivery through Twilio, configure:

```env
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
```

Users should then choose **Twilio SMS** as the delivery method and enter a phone number in E.164 format, for example `+15551234567`.

### Carrier gateway SMS

Carrier gateway delivery sends a short email message to the carrier-provided SMS/MMS gateway address.

This mode does **not** require Twilio. It uses the same email provider configuration as scheduled run email notifications.

Examples:

- AT&T: `5551234567@txt.att.net`
- Verizon: `5551234567@vtext.com`
- T-Mobile: `5551234567@tmomail.net`

Users can also enter any other carrier-specific gateway address directly in the UI.

Because carrier gateway behavior is controlled by the carrier, delivery reliability, formatting, throttling, and long-message handling may vary.

### Browser push

To enable browser push notifications, configure:

```env
WEB_PUSH_VAPID_PUBLIC_KEY=
WEB_PUSH_VAPID_PRIVATE_KEY=
# optional
WEB_PUSH_SUBJECT=
```

Users must enable push in the scheduled runs settings and subscribe the current browser.

## Scheduler runtime settings

The background runner is configured with these optional environment variables:

```env
SCHEDULED_RUNNER_ENABLED=true
SCHEDULED_RUNNER_POLL_INTERVAL_MS=15000
SCHEDULED_RUNNER_LEASE_MS=300000
SCHEDULED_RUNNER_HEARTBEAT_MS=30000
SCHEDULED_RUNNER_MAX_CONCURRENT=2
```

## Conversation links in notifications

Scheduled run notifications include conversation links when available. These links are built from `DOMAIN_CLIENT`, so set that value to the public LibreChat URL in production.

## Quick verification

After starting LibreChat locally, you can confirm the scheduled run routes exist:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/api/schedules
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/api/schedules/notifications
```

Unauthenticated local checks should return `401` once the routes are mounted.
