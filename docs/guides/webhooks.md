# Webhooks

Helios posts each request event to your webhook URL as a `POST` with a JSON body. Your URL must use `https`, and every delivery is signed with your webhook secret, so verify the signature before you trust the payload.

## Headers

- `Helios-Signature`: `t=<unix>,v1=<hex>`, where `v1` is the HMAC-SHA256 of `"<t>.<rawBody>"` computed with your webhook secret
- `Helios-Event-Id`: stable for each event. Redeliveries of the same event keep the same value, so use it to dedupe
- `Helios-Event`: the event name, for example `item.completed`

## Verifying the signature

1. Parse `t` and `v1` from `Helios-Signature`.
2. Reject the request if `|now - t|` is more than 300 seconds.
3. Compute the HMAC-SHA256 over `${t}.${rawBody}` with your secret. Use the raw request bytes, not re-serialized JSON.
4. Compare the result with `v1` using a constant-time comparison.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SECONDS = 300;

export function verifyHeliosSignature(rawBody, signatureHeader, secret) {
	const { t, v1 } = Object.fromEntries(signatureHeader.split(",").map((part) => part.split("=", 2)));
	const age = Math.abs(Date.now() / 1000 - Number(t));
	if (!t || !v1 || !(age <= TOLERANCE_SECONDS)) return false;
	const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
	const received = Buffer.from(v1, "hex");
	return received.length === expected.length && timingSafeEqual(received, expected);
}
```

## Idempotency

Store `Helios-Event-Id` after you process an event, and skip any event whose id you have already processed. Return a 2xx response for duplicates so Helios stops retrying them.

## Ordering

Webhooks are delivered first in, first out for each request. The body also has `sequence`, a per-request number that starts at 1 and increases in creation order. Sequences only order the events you receive. They can have gaps, so a gap does not mean an event was lost.

## Payload contents

Request and asset fields in a payload reflect the asset at delivery time, not at the time the event was created. A retry can therefore carry newer asset data than the first attempt.

## Retries

A delivery is successful when your endpoint returns a 2xx status. A non-2xx status, a timeout or a network error is retried with these waits: 30 seconds, 2 minutes, 10 minutes, 30 minutes and 2 hours. That is five retries after the first attempt. If the last retry fails, the delivery is marked failed. Retries keep the same `Helios-Event-Id`.

## Redelivery

`POST /requests/{id}/callbacks/redeliver` resends the request's final event. It keeps the same `Helios-Event-Id`, so use it for events your endpoint never received. If you already processed the event, your idempotency check skips the repeat.

## Testing

`POST /destinations/test` sends a `helios.test` event to your webhook destination, so you can check your endpoint and signature verification before you rely on it. The test event has `sequence` 0; real events start at 1. Tests are limited per account, and a test inside the cooldown returns `429` with a `Retry-After` header. Admins can test an account with `POST /admin/accounts/:id/destinations/test`. The response is `{ ok, httpStatus?, error? }`.
