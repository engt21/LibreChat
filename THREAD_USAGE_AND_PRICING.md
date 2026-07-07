# Thread Usage And Recorded Pricing

This document describes the branch-specific Thread Usage side panel, transaction pricing
provenance, and the rules used to present historical USD cost without inventing provider charges.

## User-facing behavior

- `Thread Usage` reports the currently selected generation branch, not hidden sibling generations.
- Totals and per-assistant-turn rows include input, output, cache-read, cache-write, and tool-call
  counts.
- USD values come only from persisted transaction rows. Estimated token counts are never repriced.
- A plain currency value means all persisted token transactions for that turn used a catalog or
  endpoint-configured rate and no separately billed tool call was detected.
- A `>=` value is a recorded token-cost lower bound. Legacy transaction provenance or tool usage can
  make the provider invoice higher or different.
- An em dash means no catalog or endpoint-configured USD value can be shown safely.
- The panel does not query Langfuse. LibreChat and Langfuse share provider price-catalog inputs, but
  the chat UI reads LibreChat's immutable transaction ledger directly.

## Pricing provenance

New transaction rows persist:

- `pricingSource: catalog` when the model matched LibreChat's provider price catalog.
- `pricingSource: endpoint_config` when an explicit endpoint token-price override supplied the rate.
- `pricingSource: fallback` when accounting retained LibreChat's generic credit multiplier because no
  verified model price was available.
- `pricingSourceDetail` for structured prompt input, cache-write, and cache-read components.
- `inputTokenCount` so tiered long-context pricing can be audited after the request.

`fallback` preserves existing balance-accounting behavior, including legacy family-derived rates,
but Thread Usage must not present those non-published rates as provider cost. Legacy rows without
provenance may still contribute a visible lower bound when they contain `tokenValue` or
`rawAmount * rate`, but they can never make `costComplete` true.

When a provider reports cache-read or cache-write tokens but neither the model catalog nor an
endpoint override has a cache rate, balance accounting still inherits the input rate for continuity.
That inherited component is persisted as `fallback`, so the sidebar does not claim the resulting
aggregate prompt transaction is fully official/configured pricing.

## Audited catalog rows

The following standard direct-API rates are encoded in USD per one million tokens. This snapshot was
verified against official provider pricing on July 6, 2026.

| Model                                                 | Input | Cache write | Cache read | Output |
| ----------------------------------------------------- | ----: | ----------: | ---------: | -----: |
| GPT-5.5                                               |  5.00 |        5.00 |       0.50 |  30.00 |
| GPT-5.5, over 272K input                              | 10.00 |       10.00 |       1.00 |  45.00 |
| GPT-5.5 Pro                                           | 30.00 |         n/a |        n/a | 180.00 |
| GPT-5.5 Pro, over 272K input                          | 60.00 |         n/a |        n/a | 270.00 |
| GPT-5.4                                               |  2.50 |        2.50 |       0.25 |  15.00 |
| GPT-5.4, over 272K input                              |  5.00 |        5.00 |       0.50 |  22.50 |
| GPT-5.4 Mini                                          |  0.75 |        0.75 |      0.075 |   4.50 |
| GPT-5.4 Nano                                          |  0.20 |        0.20 |       0.02 |   1.25 |
| GPT-5.4 Pro                                           | 30.00 |         n/a |        n/a | 180.00 |
| GPT-5.4 Pro, over 272K input                          | 60.00 |         n/a |        n/a | 270.00 |
| Claude Fable 5                                        | 10.00 |       12.50 |       1.00 |  50.00 |
| Claude Mythos 5                                       | 10.00 |       12.50 |       1.00 |  50.00 |
| Claude Opus 4.7 / 4.8                                 |  5.00 |        6.25 |       0.50 |  25.00 |
| Claude Sonnet 5, through August 31, 2026              |  2.00 |        2.50 |       0.20 |  10.00 |
| Claude Sonnet 5, starting September 1, 2026 00:00 UTC |  3.00 |        3.75 |       0.30 |  15.00 |

Anthropic cache-write values above are the default five-minute cache-write rates. One-hour cache
writes and provider-specific fast, batch, priority, regional, marketplace, or data-residency pricing
are not inferred unless an endpoint explicitly records an override.

GPT-5.6 does not have a public catalog price in this snapshot. Its existing GPT-5-family balance rate
is preserved to avoid changing credit accounting, but it is persisted with
`pricingSource: fallback`. Thread Usage renders its provider cost as unavailable instead of
mislabeling that legacy family-derived rate as an official GPT-5.6 price.

## Tool and invoice boundaries

Provider tools can add per-call, per-session, image-output, search, storage, or other charges that are
not represented by token transactions. Any turn with a detected tool call therefore keeps
`costComplete: false`, even when its token rows are fully catalog-priced.

This is deliberately conservative:

- local Code Interpreter can be zero-cost while hosted containers can be session-priced;
- web-search pricing varies by provider, quota, and billing period;
- image generation can use separate image-token or per-image prices;
- provider invoice modifiers can depend on service tier, region, batch mode, or marketplace.

The displayed value is historical recorded token cost, not a provider invoice.
The API makes this boundary explicit with `costScope: token_transactions_only`.

## Grafts and branch accounting

Generation graft copies preserve `metadata.generationGraftCopy.usageSourceMessageId`. Thread Usage
resolves the original transaction source instead of cloning debit rows. This keeps copied branches
auditable without multiplying cost.

## Main files

- `api/models/tx.js`
- `api/models/Transaction.js`
- `api/server/routes/messages.js`
- `packages/api/src/agents/transactions.ts`
- `packages/data-schemas/src/schema/transaction.ts`
- `packages/data-schemas/src/types/transaction.ts`
- `packages/data-provider/src/messages.ts`
- `client/src/components/SidePanel/Usage/ThreadUsagePanel.tsx`

## Validation

Run the focused pricing, route, and UI suites after changing this behavior:

```bash
cd api
npx jest --runInBand --testPathPatterns='models/tx.spec.js|models/Transaction.spec.js|server/routes/__tests__/messages-delete.spec.js'

cd ../packages/api
npx jest --runInBand --testPathPatterns='src/agents/transactions.spec.ts|src/agents/transactions.bulk-parity.spec.ts'

cd ../../client
npx jest --runInBand --testPathPatterns='src/components/SidePanel/Usage/ThreadUsagePanel.spec.tsx'
```

Package `dist` output must be current before API controller tests that import `@librechat/api`.

Browser validation on an isolated dev rail should also prove that:

- the selected branch excludes hidden sibling generations;
- mixed catalog-priced turns render the expected per-turn and total USD values;
- a detected tool call changes the amount to a lower-bound state;
- graft create/undo preserves the original transaction source without duplicating debit rows.
