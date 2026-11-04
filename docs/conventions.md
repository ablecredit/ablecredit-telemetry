# Conventions

Agree these once so traces from every service can be searched the same way.

## Service names

`OTEL_SERVICE_NAME` must be unique and stable per deployable: `dashboard-client`, `collector`, `workflow-executor`,
`ai-node-executor`. Never reuse one name for two services, and do not put the environment in it; use
`DEPLOYMENT_ENVIRONMENT` for that.

## Attribute names

Lowercase, dot-separated, identical in every service. A filter on `application.id` only finds services that spelled it
exactly that way.

| Attribute | Use |
|---|---|
| `application.id` | The loan/application the work is about. |
| `org.id` | The customer organisation. |
| `product.type` | Product or flow, e.g. `loan`. |
| `user.id` | Internal user id (not name or email). |
| `workflow.id` | The workflow a request is about (workflow-executor). |
| `node.id` | The workflow node a request is about. |
| `template.id` | The workflow template a request is about. |

Add new names to this table when you introduce them.

## Request bodies

Request bodies are recorded on the request span as `http.request.body`, **never as they are**. `recordRequestBody` (Node) and
`record_request_body` (Python) clean the body first, with the same rules in both languages:

| Rule | Effect |
|---|---|
| Sensitive **keys** | The value is replaced by `[redacted]`: passwords, tokens, secrets, cookies, sessions, OTP/PIN/CVV, mobile/phone/email, address, names of people, date of birth, gender and similar, PAN/Aadhaar/passport/voter/licence/KYC, bank account/IFSC/UPI/card, salary/income/balance/credit score, location and biometrics. |
| Sensitive-looking **values** | Masked anywhere inside a string, even under harmless keys: PAN, Aadhaar, mobile numbers, email, UPI handles, IFSC, GSTIN, voter id, passport, driving licence, card numbers (checked with the Luhn test and the card-network prefix), JWTs, bearer tokens, AWS keys, private keys, IP addresses, secret URL parameters (`X-Amz-Signature`, `token`, `code`, ...), passwords inside URLs, long key-like strings. |
| **Ids** stay readable | Values under id-like keys (`application_id`, `file_ids`, `_id`, ...) skip the loose number and long-string rules, so `ACDE1A187394268679AE9C5` is not mistaken for an Aadhaar number. Strict rules (PAN, email, tokens, cards) still apply. |
| **Size** | Strings over 200 characters become `[string N chars]` (never a prefix), arrays keep 30 items, nesting stops at 6 levels, binary data becomes `[binary N bytes]`, the whole result is capped at 4096 characters. |
| **Skipped entirely** | Credential-like routes (`/auth`, `/login`, `/otp`, `/password`, `/token`, `/refresh`, `/verify`, `/register`, `/sso`, `/vpd`) and file or binary bodies (multipart, images, audio, PDF, octet-stream). |

Set `OTEL_CAPTURE_REQUEST_BODY=false` to turn it off for a process. A masked body is still stored in SigNoz (and Axiom, for the
service that sends spans there), so keep adding keys you consider sensitive: pass `redactKeys` / `redact_keys`.
What the masking cannot know is free text that is sensitive only in meaning (a name written inside a remark). Keep such fields
out of request bodies you record, or add their key to `redactKeys`.

## Attributes versus the trace id

Keep trace ids random, one per request. To find traces for an application, set `application.id` on a span and filter on
it in SigNoz. Do not derive trace ids from business ids: every request for that application would merge into one
oversized trace.

An attribute belongs to the one span it is set on. Setting it on the request span lets you find the trace; child spans
do not inherit it.

## What never to record

Attributes, span names, URLs and log lines are stored in SigNoz and readable by everyone with access.

- No personal or financial data: names, phone numbers, email addresses, PAN, Aadhaar, bank details, income, scores.
- No secrets: tokens, passwords, API keys, cookies, `Authorization` headers.
- No identifiers in URLs or query strings that you would not put in a log.
- Use internal ids (`application.id`, `user.id`) and look the person up in your own systems.
- Prompt and completion text from AI calls can contain customer data. Record sizes and model names, not content,
  unless the data is cleared for it.

## Values you should not group metrics by

Ids such as `application.id` are fine for finding traces. On **metrics**, keep labels low-cardinality (route, status,
product type): every distinct value creates a new time series and drives storage cost up.
