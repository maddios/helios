# EventBridge destination setup

Helios can deliver request events to an Amazon EventBridge event bus in your AWS account instead of posting them to a webhook URL. Helios publishes each event with `PutEvents` to a bus you own, so AWS IAM authenticates the delivery and no HMAC signature is needed.

Each event uses:

- `Source`: `helios.<accountId>`, where `<accountId>` is your Helios account id. The bus policy only accepts this source.
- `DetailType`: the event name, for example `request.completed`
- `Detail`: the same JSON as the webhook body (`id`, `event`, `createdAt`, `sequence`, `data`)

The business fields are under `detail.data`.

## 1. Create or choose an event bus

The bus must be in the region you put in its ARN. To create one:

```bash
aws events create-event-bus --region <region> --name <name>
```

The bus ARN has the form `arn:aws:events:<region>:<account>:event-bus/<name>`. The bus must be in your AWS account. A bus in Helios's account is rejected with `400`.

If the bus uses a customer managed KMS key, also allow Helios's account to use that key in the key policy. A key that blocks it fails the test event with `eventbridge_access_denied`.

## 2. Attach the resource policy

Ask Helios for the policy for your bus:

```bash
curl -H "Authorization: Bearer <api-key>" \
	"https://<api-host>/destinations/eventbridge/policy?eventBusArn=<arn>"
```

The response is `{ policy, command }`. The policy grants Helios's AWS account `events:PutEvents` on that bus, only for events whose `source` is `helios.<accountId>`. It grants no access to your other buses or to any other AWS action.

`put-permission --policy` replaces the whole bus policy, so a bus with other statements must keep them. Merge the statement into the existing policy first:

```bash
aws events describe-event-bus --region <region> --name <name> --query Policy --output text > existing.json
jq --slurpfile new policy.json '.Statement += $new[0].Statement' existing.json > merged.json
aws events put-permission --region <region> --event-bus-name <name> --policy file://merged.json
```

If `describe-event-bus` returns nothing, the bus has no policy yet. Start `existing.json` from `{ "Version": "2012-10-17", "Statement": [] }`. When the bus has no other statements, the `command` in the response can be run directly with `policy.json`.

The AWS CLI shorthand (`--action`, `--principal`, `--statement-id`) cannot express the source condition, so Helios's policy is always attached with `--policy`.

## 3. Set the destination

Set the default destination for your account:

```bash
curl -X PUT -H "Authorization: Bearer <api-key>" -H "Content-Type: application/json" \
	-d '{ "destination": { "type": "eventbridge", "eventBusArn": "<arn>" } }' \
	https://<api-host>/account/destination
```

Send `{ "destination": null }` to clear it. Admins can set it with `PATCH /admin/accounts/:id`.

Or set it per request with the `destination` field on these endpoints:

- `POST /encode`
- `POST /assets/{id}/re-encode`
- `POST /assets/{id}/post-process`
- `POST /uploads/multipart/{uploadId}/complete`, inside `encode`

A request destination overrides the account default. `callbackUrl` is shorthand for a webhook destination, so it cannot be combined with `destination` in the same request.

## 4. Send a test event

```bash
curl -X POST -H "Authorization: Bearer <api-key>" -H "Content-Type: application/json" \
	-d '{ "destination": { "type": "eventbridge", "eventBusArn": "<arn>" } }' \
	https://<api-host>/destinations/test
```

The body is optional. Without it, the test uses the account's destination. Tests are limited per account: a test inside the cooldown returns `429` with a `Retry-After` header. Admins can test an account with `POST /admin/accounts/:id/destinations/test`.

The response is `{ ok, httpStatus?, error? }`. When `ok` is false, `error` contains `code`, `message` and `hint`. Use the troubleshooting table below.

## 5. Create rules on the bus

Create a rule for each event you want to route. Rules match on `source` (your account's source) and `detail-type`. Replace `<accountId>` with your Helios account id.

- `request.completed`:

```json
{ "source": ["helios.<accountId>"], "detail-type": ["request.completed"] }
```

- `item.completed` for finished video encodes only:

```json
{
	"source": ["helios.<accountId>"],
	"detail-type": ["item.completed"],
	"detail": { "data": { "item": { "kind": ["encode"], "status": ["COMPLETE"] } } }
}
```

- `item.completed` for the `image` profile only:

```json
{
	"source": ["helios.<accountId>"],
	"detail-type": ["item.completed"],
	"detail": { "data": { "item": { "profile": ["image"] } } }
}
```

- `asset.deleted`:

```json
{ "source": ["helios.<accountId>"], "detail-type": ["asset.deleted"] }
```

- `helios.test`, to route the test events you send with `POST /destinations/test`:

```json
{ "source": ["helios.<accountId>"], "detail-type": ["helios.test"] }
```

## 6. Ordering and duplicates

EventBridge does not guarantee order. To order the events of one request, sort by `sequence`. It is per request, starts at 1 for real events and increases in creation order. Test events always have sequence 0. Sequences can have gaps, so a gap does not mean an event was lost. `createdAt` is also available. To dedupe, use the event `id`, which stays the same if the same event is delivered again.

Request and asset fields reflect the asset at delivery time, not at the time the event was created.

## Troubleshooting

| Symptom                                    | Likely cause                                                         | Fix                                                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `eventbridge_access_denied` (AccessDenied) | The policy is not attached, it is on the wrong bus, or KMS blocks it | Re-run step 2 for this bus name, and check the KMS key policy                                          |
| `eventbridge_bus_not_found`                | The bus name or region in the ARN is wrong                           | Check the bus name and region, then update the destination                                             |
| `eventbridge_entry_failed`                 | The bus rejected the entry                                           | Check that the bus exists and accepts events from Helios, then test again                              |
| `400` with "bus in your AWS account"       | The ARN points at Helios's own account                               | Use a bus in your AWS account                                                                          |
| Payload over 256 KB                        | EventBridge rejects oversized entries and Helios does not retry them | Reduce output metadata, for example by fetching fewer outputs per request                              |
| Test is `ok` but no events arrive          | The rule patterns do not match the events                            | Check `source` (it includes your account id) and `detail-type` in each rule against the examples above |
| `429` with `Retry-After`                   | A test was sent inside the cooldown                                  | Wait for the `Retry-After` seconds, then test again                                                    |
| Wrong region                               | The ARN region is not the bus region                                 | Use the ARN of the bus, with its region, as shown by `aws events describe-event-bus`                   |
