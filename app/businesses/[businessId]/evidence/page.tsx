import Link from "next/link";
import { admitFactAction } from "../../../actions";
import { getEvidenceStateService } from "@/foundation";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ error?: string }>;
};

type EvidenceState = Awaited<ReturnType<ReturnType<typeof getEvidenceStateService>["getCurrent"]>>;
type Claim = EvidenceState["claims"]["facts"][number];

function Lineage({ item }: { item: Claim | EvidenceState["evidence"][number] | EvidenceState["metrics"][number] }) {
  if (!item.lineage) return <span className="muted">Entered outside Evidence Review.</span>;
  return (
    <span className="muted">
      Review {item.lineage.review.decision.toLowerCase()} from proposal {item.lineage.proposal?.proposalRef ?? "unknown"}
      {item.lineage.review.reason ? ` — ${item.lineage.review.reason}` : ""}.
    </span>
  );
}

function ClaimGroup({
  title,
  claims,
  businessId,
  evidenceItems,
}: {
  title: string;
  claims: Claim[];
  businessId: string;
  evidenceItems: EvidenceState["evidence"];
}) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {claims.length === 0 ? <p className="muted">None recorded.</p> : claims.map((claim) => (
        <article className="record" key={claim.id}>
          <h3>{claim.statement}</h3>
          <p>{claim.subjectArea} · {claim.confidenceLevel} confidence</p>
          <details><summary>Confidence and authority record</summary><pre>{JSON.stringify(claim.confidenceBasis, null, 2)}</pre></details>
          <Lineage item={claim} />
          {claim.claimType !== "fact" && evidenceItems.length > 0 ? (
            <details>
              <summary>Admit as fact with human confirmation</summary>
              <form action={admitFactAction} className="form-grid compact-form">
                <input type="hidden" name="businessId" value={businessId} />
                <input type="hidden" name="claimId" value={claim.id} />
                <input type="hidden" name="statement" value={claim.statement} />
                <input type="hidden" name="subjectArea" value={claim.subjectArea} />
                <label>
                  Supporting evidence
                  <select name="evidenceId" required defaultValue="">
                    <option value="" disabled>Select evidence</option>
                    {evidenceItems.map((evidenceItem) => (
                      <option key={evidenceItem.id} value={evidenceItem.id}>{evidenceItem.statement}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Reviewer identity
                  <input name="reviewerId" required placeholder="Your name or internal identifier" />
                </label>
                <label>
                  Confirmation basis
                  <textarea name="basis" required placeholder="Why this evidence supports factual admission" />
                </label>
                <button type="submit">Confirm fact admission</button>
              </form>
            </details>
          ) : null}
        </article>
      ))}
    </section>
  );
}

export default async function EvidenceStatePage({ params, searchParams }: PageProps) {
  const { businessId } = await params;
  const { error } = await searchParams;
  const state = await getEvidenceStateService().getCurrent(businessId);
  const reviewedEvidence = state.evidence.filter((item) => (
    item.lineage && ["ACCEPTED", "CORRECTED"].includes(item.lineage.review.decision)
  ));
  const claimGroups: Array<[string, Claim[]]> = [
    ["Facts", state.claims.facts],
    ["Observations", state.claims.observations],
    ["Management beliefs", state.claims.managementBeliefs],
    ["Hypotheses", state.claims.hypotheses],
    ["AI inferences", state.claims.aiInferences],
    ["Unknowns", state.claims.unknowns],
  ];

  return (
    <main>
      <nav><Link href="/">Businesses</Link> / Evidence State</nav>
      <p className="eyebrow">Evidence State</p>
      <h1>{state.business.name}</h1>
      <p className="lede">Canonical strategic state accepted by a human. AI proposals never appear here unless reviewed.</p>
      {error ? <p className="error" role="alert">{error}</p> : null}

      {claimGroups.map(([title, claims]) => (
        <ClaimGroup
          key={title}
          title={title}
          claims={claims}
          businessId={businessId}
          evidenceItems={reviewedEvidence}
        />
      ))}

      <section className="panel">
        <h2>Evidence</h2>
        {state.evidence.length === 0 ? <p className="muted">None recorded.</p> : state.evidence.map((item) => (
          <article className="record" key={item.id}>
            <h3>{item.statement}</h3>
            <p>{item.sourceType}{item.sourceReference ? ` · ${item.sourceReference}` : ""}</p>
            <p>Reliability: {item.reliabilityLevel} · Directness: {item.directnessLevel} · Materiality: {item.materiality}</p>
            <details><summary>Source provenance</summary><pre>{JSON.stringify(item.sourceMetadata, null, 2)}</pre></details>
            <Lineage item={item} />
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>Metrics</h2>
        {state.metrics.length === 0 ? <p className="muted">None recorded.</p> : state.metrics.map((item) => (
          <article className="record" key={item.id}>
            <h3>{item.metricLabel}</h3>
            <p>{item.numericValue} {item.unit}</p>
            <p className="muted">Source evidence: {item.sourceEvidenceId ?? "none linked"}</p>
            <Lineage item={item} />
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>Claim / evidence relationships</h2>
        {state.relationships.length === 0 ? <p className="muted">None recorded.</p> : state.relationships.map((item) => (
          <article className="record" key={`${item.claimId}-${item.evidenceId}-${item.relationshipType}`}>
            <strong>{item.relationshipType}</strong>
            <p className="muted">Claim {item.claimId}<br />Evidence {item.evidenceId}</p>
            {item.lineage ? <p className="muted">Reviewed from proposal {item.lineage.proposal?.proposalRef ?? "unknown"}.</p> : null}
          </article>
        ))}
      </section>
    </main>
  );
}
