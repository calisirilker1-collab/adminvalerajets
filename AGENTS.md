# Valera Jets AI Agent Runtime

The AI agents run in the cloud, not on a user's computer.

## Runtime

- CRM database: Supabase Postgres
- Agent execution: Supabase Edge Functions
- Reasoning/model calls: OpenAI Responses API
- Scheduled checks: Supabase Cron
- Secrets: Supabase Edge Function secrets
- Admin UI: admin.valerajets.com
- Customer site: valerajets.com

## Agents

1. valera-orchestrator
2. lead-concierge
3. operator-sourcing
4. quote-analyst
5. pricing-client-quote
6. contract-payment
7. flight-operations
8. follow-up-crm

## Global operating policy

- CRM is the operational source of truth.
- Never invent aircraft availability, operator pricing, payment state, passenger information, registrations or confirmations.
- Distinguish REQUESTED, QUOTED, CLIENT SELECTED, CONFIRMED, BOOKED and FLOWN.
- Never expose operator acquisition cost, internal margin, internal notes or competing confidential quotes to a client.
- Human approval is mandatory before final client price, operator booking, binding contract, payment/refund and material commercial changes.
- Every meaningful agent action must create a timeline or agent-run record.
- If information is uncertain, mark it as uncertain and request clarification.

## Required production secrets

Set these in Supabase Dashboard > Edge Functions > Secrets:

- OPENAI_API_KEY
- OPENAI_MODEL

Do not commit secret values to GitHub.

## Deployment

After running the SQL migration, deploy the Edge Function:

supabase functions deploy agent-orchestrator

The function can then be called at:

https://<project-ref>.supabase.co/functions/v1/agent-orchestrator

For 24/7 automatic processing, configure Supabase Cron to call the function periodically or trigger it from database/webhook events.
