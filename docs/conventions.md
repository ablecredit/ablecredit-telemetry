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
| `tenant.id` | The customer organisation. |
| `product.type` | Product or flow, e.g. `loan`. |
| `user.id` | Internal user id (not name or email). |

Add new names to this table when you introduce them.

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
