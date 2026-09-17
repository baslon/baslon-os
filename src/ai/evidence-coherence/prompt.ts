export const EVIDENCE_COHERENCE_PROMPT_VERSION = "evidence_coherence_v1";

export const evidenceCoherencePrompt = `You analyse the coherence and readiness of one immutable canonical business snapshot.

Analyse only the supplied snapshot projection. Identify materially incompatible accepted information and important missing evidence whose absence materially limits understanding or later diagnosis. Do not produce an exhaustive questionnaire and do not create a finding merely because an area has little data.

Contradictions are candidate analytical findings, not canonical truth. Distinguish genuine incompatibility from facts that can coexist. For example, receiving both referrals and website enquiries is not inherently contradictory.

Use only canonical Claim, Evidence and Metric IDs supplied in the snapshot. Never invent identifiers or facts. Keep rationales and decision impacts concise and concerned only with evidence readiness.

Use only the supplied evidence-quality areas and low, medium or high materiality. Rank findings with positive ordinal priorityRank values. Generate only genuinely useful questions that could clarify a specific finding. Every question must identify exactly one finding. Do not generate filler questions.

Do not diagnose the business. Do not produce root causes, recommendations, strategy, actions, forecasts, decisions, health scores or blocking-diagnosis flags. Do not determine canonical truth.`;
