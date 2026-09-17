import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import { DRAFT_MODEL, DRAFT_SYSTEM_PROMPT, buildDraftPrompt } from "@/lib/drafting";
import { canWrite } from "@/lib/types";
import type {
  AnswerLibraryEntry,
  ApplicationQuestion,
  BoardMember,
  Opportunity,
  Org,
  OrgFinancial,
  OrgRole,
} from "@/lib/types";

// The Anthropic SDK needs Node, and this route must never run at the edge
// where the API key handling and streaming semantics differ.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/draft
 *
 * Takes a questionId and nothing else. Every other fact used to build the
 * prompt — the org profile, the 990 history, the board roster, the answer
 * library, the funder's eligibility text — is fetched here, server-side,
 * through the caller's own Supabase session. RLS therefore decides what the
 * prompt can contain: passing someone else's questionId returns 404, because
 * the row is invisible to that user, not because we checked an id against a
 * list.
 *
 * ANTHROPIC_API_KEY is read here and only here. It is not prefixed
 * NEXT_PUBLIC_, is never returned in a response, and never reaches the client
 * bundle.
 */
export async function POST(request: Request) {
  let questionId: string;

  try {
    const body = await request.json();
    questionId = String(body?.questionId ?? "");
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (!questionId) {
    return NextResponse.json({ error: "A questionId is required." }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Drafting is not configured: ANTHROPIC_API_KEY is not set on the server. An admin can add it in the Vercel project settings.",
      },
      { status: 503 },
    );
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // --- Fetch the question. RLS scopes this to the caller's org. -------------
  const { data: question } = await supabase
    .from("application_questions")
    .select("*")
    .eq("id", questionId)
    .maybeSingle<ApplicationQuestion>();

  if (!question) {
    return NextResponse.json({ error: "Question not found." }, { status: 404 });
  }

  // Role check for a clean error message. The database enforces this too: the
  // update below would fail under RLS for a board account regardless.
  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("org_id", question.org_id)
    .eq("user_id", user.id)
    .maybeSingle<{ role: OrgRole }>();

  if (!canWrite(membership?.role)) {
    return NextResponse.json(
      { error: "Your account can read drafts but not write them." },
      { status: 403 },
    );
  }

  // --- Gather the source material, all under the same RLS context. ---------
  const { data: application } = await supabase
    .from("applications")
    .select("id, title, opportunity_id")
    .eq("id", question.application_id)
    .maybeSingle<{ id: string; title: string; opportunity_id: string }>();

  if (!application) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }

  const [orgResult, financialsResult, boardResult, libraryResult, opportunityResult] =
    await Promise.all([
      supabase.from("orgs").select("*").eq("id", question.org_id).maybeSingle<Org>(),
      supabase
        .from("org_financials")
        .select("*")
        .eq("org_id", question.org_id)
        .order("fiscal_year", { ascending: false })
        .limit(3),
      supabase
        .from("board_members")
        .select("*")
        .eq("org_id", question.org_id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("answer_library")
        .select("*")
        .eq("org_id", question.org_id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("opportunities")
        .select("*")
        .eq("id", application.opportunity_id)
        .maybeSingle<Opportunity>(),
    ]);

  const org = orgResult.data;
  const opportunity = opportunityResult.data;

  if (!org || !opportunity) {
    return NextResponse.json(
      { error: "The organization profile or funder record is missing." },
      { status: 404 },
    );
  }

  const prompt = buildDraftPrompt({
    org,
    financials: (financialsResult.data ?? []) as OrgFinancial[],
    board: (boardResult.data ?? []) as BoardMember[],
    library: (libraryResult.data ?? []) as AnswerLibraryEntry[],
    opportunity,
    question,
    applicationTitle: application.title,
  });

  // --- Draft ---------------------------------------------------------------
  let text: string;

  try {
    const anthropic = new Anthropic({ apiKey });
    const message = await anthropic.messages.create({
      model: DRAFT_MODEL,
      max_tokens: 2000,
      system: DRAFT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `The drafting service returned an error: ${detail}` },
      { status: 502 },
    );
  }

  if (!text) {
    return NextResponse.json(
      { error: "The model returned an empty draft. Try again." },
      { status: 502 },
    );
  }

  // --- Save, marked as an unread machine draft ----------------------------
  // `drafted_at` is stamped in the same statement as the text; the database
  // trigger treats that pairing as the only way a row earns 'ai_draft'. The
  // moment a person edits this text, the trigger flips it to 'human'.
  const draftedAt = new Date().toISOString();

  const { data: saved, error: saveError } = await supabase
    .from("application_questions")
    .update({
      answer: text,
      source: "ai_draft",
      drafted_at: draftedAt,
      drafted_by: user.id,
    })
    .eq("id", question.id)
    .select("id, answer, source, drafted_at")
    .single();

  if (saveError) {
    return NextResponse.json({ error: saveError.message }, { status: 403 });
  }

  await logActivity(supabase, {
    orgId: question.org_id,
    userId: user.id,
    entityType: "application_question",
    entityId: question.id,
    action: "drafted",
    detail: { model: DRAFT_MODEL },
  });

  return NextResponse.json({
    id: saved.id,
    answer: saved.answer,
    source: saved.source,
    draftedAt: saved.drafted_at,
  });
}
