import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const RFQ_FROM_EMAIL = Deno.env.get('RFQ_FROM_EMAIL') ?? '';
const RFQ_REPLY_TO = Deno.env.get('RFQ_REPLY_TO') ?? '';
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://admin.valerajets.com';

const allowedOrigins = new Set([
  ALLOWED_ORIGIN,
  'https://admin.valerajets.com',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function value(row: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const candidate = row[key];
    if (candidate !== undefined && candidate !== null && candidate !== '') return candidate;
  }
  return '';
}

function airportCode(text: unknown) {
  const input = String(text || '—');
  const match = input.match(/\(([A-Z0-9]{3,4})\)\s*$/i);
  return match ? match[1].toUpperCase() : input;
}

function rfqDate(input: unknown) {
  if (!input) return 'TBD';
  const date = new Date(String(input).length === 10 ? `${input}T12:00:00Z` : String(input));
  if (Number.isNaN(date.getTime())) return String(input);
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date).toUpperCase();
}

function leadNo(row: Record<string, unknown>) {
  if (row.lead_number) return `VJ-${String(row.lead_number).padStart(4, '0')}`;
  return `VJ-${String(row.id || '').split('-')[0].toUpperCase()}`;
}

function regexEscape(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function specialRequirements(request: Record<string, unknown>) {
  let special = String(value(request, 'notes') || '').trim();
  if (!special) return 'None advised at this stage.';
  const protectedValues = [value(request, 'full_name', 'name'), request.email, request.phone]
    .map((item) => String(item || '').trim())
    .filter((item) => item.length > 2);
  for (const protectedValue of protectedValues) {
    special = special.replace(new RegExp(regexEscape(protectedValue), 'gi'), '[redacted]');
  }
  return special
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted]');
}

function buildRfq(request: Record<string, unknown>) {
  const from = String(value(request, 'origin', 'from_location', 'from_city', 'from') || '—');
  const to = String(value(request, 'destination', 'to_location', 'to_city', 'to') || '—');
  const date = rfqDate(value(request, 'departure_date', 'departure'));
  const returnDate = value(request, 'return_date', 'returnDate');
  const pax = value(request, 'passengers') || '—';
  const rawAircraft = String(value(request, 'jet_type', 'jetType') || '');
  const aircraft = !rawAircraft || /farketmez|open|uygun/i.test(rawAircraft)
    ? 'Open / Best suitable option'
    : rawAircraft;
  const time = value(request, 'preferred_departure_time') || 'TBD / Flexible';
  const trip = value(request, 'trip_type', 'tripType') || '—';
  const special = specialRequirements(request);
  const reference = leadNo(request);
  const subject = `RFQ ${reference} | ${airportCode(from)} → ${airportCode(to)} | ${date} | ${pax} PAX`;
  const returnLine = returnDate ? `\nReturn date: ${rfqDate(returnDate)}` : '';
  const body = `Hello,\n\nPlease provide your best charter quotation for the following request:\n\nRFQ Reference: ${reference}\nRoute: ${from} → ${to}\nDate: ${date}${returnLine}\nPreferred departure time: ${time}\nPassengers: ${pax}\nTrip type: ${trip}\nAircraft category: ${aircraft}\n\nSpecial requirements:\n${special}\n\nPlease include in your quotation:\n- Aircraft type and model\n- Aircraft registration, if available\n- Year of manufacture / refurbishment, if available\n- Total charter price including applicable taxes and handling fees\n- Aircraft availability\n- Estimated flight time\n- Quote validity\n- Cancellation terms\n- Payment terms\n- Repositioning costs, if any\n- Catering included / excluded\n\nPlease also advise if you have any suitable empty-leg or repositioning opportunity for this route.\n\nBest regards,\nValera Jets\nCharter Desk`;
  return { subject, body, reference };
}

function escapeHtml(input: string) {
  return input.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[char] ?? char);
}

function emailHtml(body: string) {
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.65;color:#15191f;white-space:pre-line">${escapeHtml(body)}</div>`;
}

function validUuid(input: unknown) {
  return typeof input === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input);
}

export default {
fetch: async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(req, { error: 'Supabase function environment is incomplete.' }, 500);
  }
  const authorization = req.headers.get('Authorization') ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  if (!token) return json(req, { error: 'Authentication required.' }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return json(req, { error: 'Invalid session.' }, 401);
  const { data: isAdmin, error: adminError } = await userClient.rpc('is_valera_admin');
  if (adminError || isAdmin !== true) return json(req, { error: 'Admin access required.' }, 403);
  if (!RESEND_API_KEY || !RFQ_FROM_EMAIL) {
    return json(req, { error: 'RESEND_API_KEY or RFQ_FROM_EMAIL is not configured.' }, 503);
  }

  let payload: { request_id?: string; operator_ids?: string[]; batch_id?: string };
  try {
    payload = await req.json();
  } catch {
    return json(req, { error: 'Invalid JSON body.' }, 400);
  }

  const requestId = payload.request_id;
  const batchId = payload.batch_id;
  const operatorIds = [...new Set(Array.isArray(payload.operator_ids) ? payload.operator_ids : [])];
  if (!validUuid(requestId) || !validUuid(batchId)) return json(req, { error: 'Valid request_id and batch_id are required.' }, 400);
  if (!operatorIds.length || operatorIds.length > 25 || operatorIds.some((id) => !validUuid(id))) {
    return json(req, { error: 'Choose between 1 and 25 valid operators.' }, 400);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: flight, error: flightError }, { data: operators, error: operatorsError }] = await Promise.all([
    admin.from('flight_requests').select('*').eq('id', requestId).single(),
    admin.from('operator_directory').select('id,name,aoc_no,email,is_active').in('id', operatorIds).eq('is_active', true),
  ]);
  if (flightError || !flight) return json(req, { error: 'Flight request not found.' }, 404);
  if (operatorsError) return json(req, { error: operatorsError.message }, 500);

  const validOperators = (operators ?? []).filter((operator) => operator.email);
  const { subject, body, reference } = buildRfq(flight as Record<string, unknown>);
  const results: Array<Record<string, unknown>> = [];

  for (const operator of validOperators) {
    const baseRecord = {
      request_id: requestId,
      operator_id: operator.id,
      operator_name: operator.name,
      operator_email: operator.email,
      subject,
      body,
      status: 'draft',
      batch_id: batchId,
      delivery_status: 'processing',
      sent_by: userData.user.id,
      error_message: null,
    };

    const { data: log, error: logError } = await admin
      .from('rfq_requests')
      .upsert(baseRecord, { onConflict: 'batch_id,operator_id', ignoreDuplicates: true })
      .select('id,status,delivery_status,provider_message_id')
      .maybeSingle();

    if (logError) {
      results.push({ operator_id: operator.id, operator_name: operator.name, ok: false, error: logError.message });
      continue;
    }

    let logId = log?.id;
    if (!logId) {
      const { data: existing } = await admin.from('rfq_requests').select('id,status,delivery_status,provider_message_id').eq('batch_id', batchId).eq('operator_id', operator.id).maybeSingle();
      logId = existing?.id;
      if (existing?.delivery_status === 'sent') {
        results.push({ operator_id: operator.id, operator_name: operator.name, ok: true, duplicate: true, message_id: existing.provider_message_id });
        continue;
      }
    }

    try {
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `rfq-${batchId}-${operator.id}`,
        },
        body: JSON.stringify({
          from: RFQ_FROM_EMAIL,
          to: [operator.email],
          ...(RFQ_REPLY_TO ? { reply_to: RFQ_REPLY_TO } : {}),
          subject,
          text: body,
          html: emailHtml(body),
          tags: [
            { name: 'category', value: 'operator-rfq' },
            { name: 'reference', value: reference.toLowerCase() },
          ],
        }),
      });
      const provider = await resendResponse.json();
      if (!resendResponse.ok) throw new Error(provider?.message || `Resend HTTP ${resendResponse.status}`);

      await admin.from('rfq_requests').update({
        status: 'sent', delivery_status: 'sent', sent_at: new Date().toISOString(),
        provider_message_id: provider.id, error_message: null,
      }).eq('id', logId);
      await admin.from('operator_directory').update({ last_contacted_at: new Date().toISOString() }).eq('id', operator.id);
      results.push({ operator_id: operator.id, operator_name: operator.name, ok: true, message_id: provider.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown email provider error';
      if (logId) await admin.from('rfq_requests').update({ delivery_status: 'failed', error_message: message }).eq('id', logId);
      results.push({ operator_id: operator.id, operator_name: operator.name, ok: false, error: message });
    }
  }

  const sentCount = results.filter((result) => result.ok).length;
  const failedCount = operatorIds.length - sentCount;
  if (sentCount > 0) {
    if (['new', 'qualified'].includes(String(flight.status || 'new'))) {
      await admin.from('flight_requests').update({ status: 'sourcing' }).eq('id', requestId);
    }
    await admin.from('deal_timeline').insert({
      request_id: requestId,
      actor_user_id: userData.user.id,
      event_type: 'rfq_batch_sent',
      title: `RFQ gönderildi · ${sentCount} operatör`,
      detail: `${subject}${failedCount ? ` · ${failedCount} başarısız` : ''}`,
    });
  }

  return json(req, {
    ok: failedCount === 0,
    batch_id: batchId,
    sent_count: sentCount,
    failed_count: failedCount,
    results,
  });
},
};
