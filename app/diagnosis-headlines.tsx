import Link from "next/link";
import {
  approveDiagnosisHeadlineSetAction,
  proposeDiagnosisHeadlinesAction,
  reviewDiagnosisHeadlineAction,
  startDiagnosisHeadlineReviewAction,
} from "./actions";
import { HEADLINE_MAX_LENGTH } from "@/domain/diagnosis-headline";
import type { DiagnosisHeadlineViewModel } from "@/services/diagnosis-headline-service";
import { ApprovalTime } from "./phase1-diagnosis-shared";
import { itemTypeLabels } from "./phase1-diagnosis-approved";

type Item = DiagnosisHeadlineViewModel["items"][number];

const typeLabel = (itemType: string) => itemTypeLabels[itemType] ?? itemType.replaceAll("_", " ");

/**
 * The headline-only companion review of an already-approved diagnosis. The
 * approved statement stays visible beside every proposed headline, and nothing
 * else about the approved diagnosis is re-reviewed here: rationale, grounding,
 * materiality, limitations and references are already approved and unchanged.
 */
function HeadlineCard({ model, item, readOnly }: { model: DiagnosisHeadlineViewModel; item: Item; readOnly: boolean }) {
  const session = model.session;
  const canDecide = session?.status === "OPEN" && !item.decision && !readOnly;
  const hidden = session ? <>
    <input type="hidden" name="businessId" value={model.business.id} />
    <input type="hidden" name="reviewSessionId" value={session.id} />
    <input type="hidden" name="reviewerId" value={session.reviewerId} />
    <input type="hidden" name="diagnosisItemId" value={item.diagnosisItemId} />
  </> : null;
  return <article className="record-card" aria-label={`Headline for ${item.itemRef}`} data-headline-item={item.itemRef}>
    <p className="badges"><span className="badge">{typeLabel(item.itemType)}</span></p>
    <p className="finding-statement" data-field="statement">{item.statement}</p>
    <dl className="item-detail">
      <div data-field="proposed"><dt>Proposed headline</dt>
        <dd>{item.proposed ?? <span className="muted">Not proposed yet</span>}</dd></div>
      {item.decision ? <div data-field="decision"><dt>Decision</dt><dd>
        {item.decision.decision === "CORRECTED" ? "Corrected" : "Accepted"}
        {item.decision.reason ? <> — {item.decision.reason}</> : null}
      </dd></div> : null}
      {item.finalHeadline ? <div data-field="final"><dt>Final headline</dt>
        <dd className="finding-headline">{item.finalHeadline}</dd></div> : null}
    </dl>
    {canDecide && item.proposed ? <div className="decision-forms">
      <form action={reviewDiagnosisHeadlineAction}>{hidden}
        <input type="hidden" name="decision" value="ACCEPTED" />
        <button type="submit">Accept</button></form>
      <details><summary>Correct this headline</summary>
        <form action={reviewDiagnosisHeadlineAction}>{hidden}
          <input type="hidden" name="decision" value="CORRECTED" />
          <label>Headline<input name="correctedHeadline" defaultValue={item.proposed} maxLength={HEADLINE_MAX_LENGTH} required /></label>
          <label>Reason for correcting<input name="reason" /></label>
          <p className="note">A headline is a label for the approved statement above. It cannot add a fact, a number the statement does not carry, a recommendation or more certainty.</p>
          <button type="submit">Save correction</button>
        </form>
      </details>
    </div> : null}
  </article>;
}

export function DiagnosisHeadlines({ model, error }: { model: DiagnosisHeadlineViewModel; error?: string }) {
  const { business, approved, run, session } = model;
  const archived = business.status === "archived";
  const readOnly = archived || model.workflowState !== "PHASE1_APPROVED";
  const decided = model.items.filter((item) => item.decision).length;
  const allDecided = model.items.length > 0 && decided === model.items.length;
  const retryable = model.failedRuns.length === 1 && !run;
  const diagnosisHref = `/businesses/${business.id}/diagnosis`;

  return <main>
    <nav className="breadcrumbs"><Link href="/businesses">Businesses</Link> <span aria-hidden="true">/</span> <Link href={`/businesses/${business.id}`}>{business.name}</Link> <span aria-hidden="true">/</span> <Link href={diagnosisHref}>Phase 1 Diagnosis</Link> <span aria-hidden="true">/</span> Headlines</nav>
    <p className="context-name">{business.name}</p>
    <h1 className="task-title">Diagnosis headlines</h1>
    <p className="lede">A headline is a short, reviewed label for an approved diagnosis statement. It adds no finding, no recommendation and no priority. The approved statement remains the analytical authority, and approving headlines changes nothing about the approved diagnosis.</p>
    {error ? <p className="error" role="alert">{error}</p> : null}
    {archived ? <div className="notice"><strong>Archived — read-only</strong></div> : null}

    {!approved ? <section className="empty-state"><h2>No approved diagnosis</h2>
      <p>Headlines label an approved Phase 1 Diagnosis. There is none for this Business yet.</p>
      <Link className="button-link" href={diagnosisHref}>Go to Phase 1 Diagnosis</Link></section> : null}

    {approved && model.native ? <section className="status-panel" data-state="native">
      <h2>This diagnosis already has reviewed headlines</h2>
      <p>Its items were reviewed under {approved.artifactVersion}, so each approved item carries its own reviewed headline. No companion headline set is needed.</p>
      <Link className="button-link" href={diagnosisHref}>View the approved diagnosis</Link>
    </section> : null}

    {approved && !model.native ? <>
      <section className="status-panel" aria-labelledby="target-heading">
        <p className="eyebrow">Approved diagnosis version {approved.version}</p>
        <h2 id="target-heading">Approved on <ApprovalTime iso={approved.approvedAt} /> by {approved.approvedBy}</h2>
        <p>{model.items.length} approved items can carry a headline. Rejected items are excluded and can never carry one.</p>
      </section>

      {!run && !readOnly ? <section className="panel" data-state="propose">
        <h2>Propose headlines</h2>
        <p>Baslon OS will ask the model for one short label per approved statement. Every headline is validated and then reviewed by you before anything is approved.</p>
        {model.failedRuns.length ? <p className="notice" role="status"><strong>The last proposal run failed.</strong> {retryable
          ? "One retry is allowed, and it needs your explicit approval."
          : "No further automatic retry is available. Report this before trying again."}</p> : null}
        {!model.failedRuns.length || retryable ? <form action={proposeDiagnosisHeadlinesAction}>
          <input type="hidden" name="businessId" value={business.id} />
          <input type="hidden" name="approvedDiagnosisId" value={approved.id} />
          {retryable ? <input type="hidden" name="retryOfFailedRunId" value={model.failedRuns[0].id} /> : null}
          <button type="submit">{retryable ? "Retry headline proposals (one retry)" : "Propose headlines"}</button>
        </form> : null}
      </section> : null}

      {run?.status === "RUNNING" ? <section className="status-panel"><p className="eyebrow">Proposal in progress</p>
        <h2>Proposing headlines</h2></section> : null}

      {run?.status === "SUCCEEDED" && !session && !readOnly ? <form action={startDiagnosisHeadlineReviewAction} className="panel">
        <h2>{model.approvedSet ? `Review headlines again (version ${model.approvedSet.version + 1})` : "Review the proposed headlines"}</h2>
        <p>You accept or correct every headline. There is no reject: a poor headline is corrected.</p>
        <input type="hidden" name="businessId" value={business.id} />
        <input type="hidden" name="approvedDiagnosisId" value={approved.id} />
        <input type="hidden" name="proposalRunId" value={run.id} />
        <label>Your name or identifier<input name="reviewerId" required /></label>
        <button type="submit">Start headline review</button>
      </form> : null}

      {model.items.length ? <section data-section="headlines">
        <h2>Approved statements and their headlines</h2>
        {session ? <p className="note">{decided} of {model.items.length} decided. Every headline needs a decision before the set can be approved.</p> : null}
        <div className="record-list">{model.items.map((item) => <HeadlineCard key={item.itemRef} model={model} item={item} readOnly={readOnly} />)}</div>
      </section> : null}

      {session?.status === "OPEN" && !readOnly ? <section className="panel" aria-labelledby="approve-headlines-heading">
        <h2 id="approve-headlines-heading">Approve headline set version {session.setVersion}</h2>
        <p>Approving records these headlines as the current labels for this exact approved diagnosis. It does not change the approved diagnosis, any statement, any evidence or the workflow.</p>
        {allDecided ? <form action={approveDiagnosisHeadlineSetAction}>
          <input type="hidden" name="businessId" value={business.id} />
          <input type="hidden" name="reviewSessionId" value={session.id} />
          <input type="hidden" name="reviewerId" value={session.reviewerId} />
          <button type="submit">Approve headline set</button>
        </form> : <p className="muted">Decide every headline (accept or correct) before approving.</p>}
      </section> : null}

      {model.approvedSet ? <section className="panel" data-section="approved-set">
        <h2>Approved headline set, version {model.approvedSet.version}</h2>
        <p>Approved by {model.approvedSet.approvedBy} · <ApprovalTime iso={model.approvedSet.approvedAt} />. This set is read-only; a change is a new version, reviewed and approved again.</p>
        <ul className="reference-list">{model.approvedSet.headlines.map((headline) => <li key={headline.itemRef} data-approved-headline={headline.itemRef}>
          {headline.headline}
        </li>)}</ul>
        {model.setHistory.length > 1 ? <p className="muted">Earlier versions: {model.setHistory
          .filter((entry) => entry.version !== model.approvedSet!.version)
          .map((entry) => `version ${entry.version} (${entry.approvedBy})`).join(", ")}. Every approved version is preserved.</p> : null}
      </section> : null}
    </> : null}
  </main>;
}
