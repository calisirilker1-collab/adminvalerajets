import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const SYSTEM_PROMPT = `
You are Valera Jets Deal Orchestrator.

Coordinate the private jet charter brokerage workflow:
new -> qualified -> sourcing -> quote_ready -> quoted -> client_confirmed -> payment_pending -> booked -> flown -> won/lost.

You do not perform specialist work when another Valera agent owns the task.
Choose the next specialist agent and action.

Specialist agents:
lead_concierge
operator_sourcing
quote_analyst
pricing_client_quote
contract_payment
flight_operations
follow_up_crm

Rules:
- CRM data is the source of truth.
- Never invent aircraft availability, pricing, registrations, payment state or confirmations.
- A quoted aircraft is not a booked aircraft.
- Human approval is mandatory before final client price, operator booking, binding contract, payments/refunds, or material commercial changes.
- If information is missing, identify it explicitly.
`;

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    current_status: { type: "string" },
    next_action: { type: "string" },
    assigned_agent: {
      type: "string",
      enum: [
        "lead_concierge",
        "operator_sourcing",
        "quote_analyst",
        "pricing_client_quote",
        "contract_payment",
        "flight_operations",
        "follow_up_crm",
        "human"
      ]
    },
    reason: { type: "string" },
    missing_information: {
      type: "array",
      items: { type: "string" }
    },
    approval_required: { type: "boolean" },
    approval_type: { type: ["string","null"] },
    priority: {
      type: "string",
      enum: ["low","normal","high","urgent"]
    }
  },
  required: [
    "current_status",
    "next_action",
    "assigned_agent",
    "reason",
    "missing_information",
    "approval_required",
    "approval_type",
    "priority"
  ]
};

function getSecretKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!raw) throw new Error("Supabase server secret is unavailable.");
  const keys = JSON.parse(raw);
  const key = keys.default || Object.values(keys)[0];
  if (!key || typeof key !== "string") throw new Error("Supabase server secret is unavailable.");
  return key;
}

async function getOpenAIOutput(body: unknown) {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  const model = Deno.env.get("OPENAI_MODEL");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  if (!model) throw new Error("OPENAI_MODEL is not configured.");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: SYSTEM_PROMPT,
      input: JSON.stringify(body),
      text: {
        format: {
          type: "json_schema",
          name: "valera_orchestrator_decision",
          strict: true,
          schema,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const text = (data.output || [])
    .filter((item: any) => item.type === "message")
    .flatMap((item: any) => item.content || [])
    .filter((item: any) => item.type === "output_text")
    .map((item: any) => item.text)
    .join("");

  if (!text) throw new Error("OpenAI returned no structured output.");
  return { model, decision: JSON.parse(text) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), { status: 405, headers: corsHeaders });
  }

  let runId: string | null = null;

  try {
    const { request_id, reason = "manual" } = await req.json();
    if (!request_id) throw new Error("request_id is required.");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) throw new Error("SUPABASE_URL is unavailable.");

    const db = createClient(supabaseUrl, getSecretKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [
      dealResult,
      rfqResult,
      operatorQuotesResult,
      clientQuotesResult,
      timelineResult,
    ] = await Promise.all([
      db.from("flight_requests").select("*").eq("id", request_id).single(),
      db.from("rfq_requests").select("*").eq("request_id", request_id).order("created_at", { ascending: false }),
      db.from("operator_quotes").select("*").eq("request_id", request_id).order("created_at", { ascending: false }),
      db.from("client_quotes").select("*").eq("request_id", request_id).order("created_at", { ascending: false }),
      db.from("deal_timeline").select("*").eq("request_id", request_id).order("created_at", { ascending: false }).limit(30),
    ]);

    if (dealResult.error) throw dealResult.error;

    const snapshot = {
      trigger_reason: reason,
      deal: dealResult.data,
      rfqs: rfqResult.data || [],
      operator_quotes: operatorQuotesResult.data || [],
      client_quotes: clientQuotesResult.data || [],
      recent_timeline: timelineResult.data || [],
    };

    const runInsert = await db.from("agent_runs").insert({
      request_id,
      agent_name: "valera_orchestrator",
      status: "running",
      input_snapshot: snapshot,
    }).select("id").single();

    if (runInsert.error) throw runInsert.error;
    runId = runInsert.data.id;

    const { model, decision } = await getOpenAIOutput(snapshot);

    let approvalId: string | null = null;
    if (decision.approval_required) {
      const approval = await db.from("agent_approvals").insert({
        request_id,
        approval_type: decision.approval_type || "human_review",
        title: decision.next_action,
        detail: decision.reason,
        payload: decision,
      }).select("id").single();

      if (approval.error) throw approval.error;
      approvalId = approval.data.id;
    }

    const taskStatus = decision.approval_required ? "waiting_approval" : "pending";

    const task = await db.from("agent_tasks").insert({
      request_id,
      agent_name: decision.assigned_agent,
      task_type: decision.next_action,
      status: taskStatus,
      priority: decision.priority,
      input: {
        orchestrator_run_id: runId,
        decision,
      },
      requires_approval: decision.approval_required,
      approval_id: approvalId,
    }).select("*").single();

    if (task.error) throw task.error;

    await db.from("agent_runs").update({
      model,
      status: "completed",
      output: decision,
      completed_at: new Date().toISOString(),
    }).eq("id", runId);

    await db.from("deal_timeline").insert({
      request_id,
      event_type: "ai_orchestrator",
      title: `AI Orchestrator · ${decision.assigned_agent}`,
      detail: `${decision.next_action} · ${decision.reason}`,
      actor_user_id: null,
    });

    return new Response(JSON.stringify({
      ok: true,
      run_id: runId,
      task: task.data,
      decision,
    }), { headers: corsHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    try {
      if (runId) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const db = createClient(supabaseUrl, getSecretKey(), {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        await db.from("agent_runs").update({
          status: "failed",
          error_message: message,
          completed_at: new Date().toISOString(),
        }).eq("id", runId);
      }
    } catch (_) {}

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
