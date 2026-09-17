import Link from "next/link";
import { analyseEvidenceAction } from "./actions";

type Model = {
  business: { id: string; name: string; status: string };
  workflow?: { state: string };
  latestSnapshot?: { id: string; version: number };
  analysis?: {
    run: { id: string; status: "RUNNING" | "SUCCEEDED" | "FAILED"; inputSnapshotId: string };
    contradictions: Array<{ id: string; area: string; statement: string; rationale: string; materiality: string }>;
    gaps: Array<{ id: string; area: string; missingInformation: string; decisionImpact: string; materiality: string }>;
  };
  isHistorical: boolean;
  surfacedQuestions: Array<{ id: string; question: string; sourceSubmissionId?: string | null }>;
};

function AnalyseAction({ businessId, retry = false }: { businessId: string; retry?: boolean }) {
  return <form action={analyseEvidenceAction}>
    <input type="hidden" name="businessId" value={businessId} />
    <button type="submit">{retry ? "Retry analysis" : "Analyse Evidence"}</button>
  </form>;
}

export function EvidenceQuality({ model, error }: { model: Model; error?: boolean }) {
  const { business, latestSnapshot, analysis } = model;
  const archived = business.status === "archived";
  const targetVersion = analysis && latestSnapshot?.id === analysis.run.inputSnapshotId
    ? latestSnapshot.version : undefined;
  return <main>
    <nav className="breadcrumbs"><Link href="/businesses">Businesses</Link> <span aria-hidden="true">/</span> <Link href={`/businesses/${business.id}`}>{business.name}</Link> <span aria-hidden="true">/</span> Evidence Quality</nav>
    <p className="context-name">{business.name}</p>
    <h1 className="task-title">Evidence Quality</h1>
    <p className="lede">Snapshot-bound analytical findings about contradictions and important gaps. These findings do not change canonical Evidence State.</p>
    {error ? <p className="error" role="alert">The analysis could not be completed. Canonical evidence remains unchanged.</p> : null}
    {archived ? <div className="notice"><strong>Archived — read-only</strong><p>Historical Evidence Quality analysis remains available.</p></div> : null}

    {!latestSnapshot ? <section className="empty-state"><h2>No canonical snapshot yet</h2><p>Complete Evidence Review before analysing Evidence Quality.</p></section> : null}
    {latestSnapshot && !analysis ? <section className="status-panel"><p className="eyebrow">Snapshot {latestSnapshot.version}</p><h2>No Evidence Quality analysis yet</h2><p>Analyse the current canonical snapshot for material contradictions and important evidence gaps.</p>{!archived ? <AnalyseAction businessId={business.id} /> : null}</section> : null}
    {analysis?.run.status === "RUNNING" ? <section className="status-panel"><p className="eyebrow">Analysis in progress</p><h2>Analysing snapshot {targetVersion ?? "history"}</h2><p>This analysis reads the immutable snapshot and does not modify canonical evidence.</p></section> : null}
    {analysis?.run.status === "FAILED" ? <section className="status-panel"><p className="eyebrow">Analysis failed</p><h2>Evidence Quality could not be completed</h2><p>Canonical evidence remains unchanged. You can safely retry this snapshot.</p>{!archived && !model.isHistorical ? <AnalyseAction businessId={business.id} retry /> : null}</section> : null}
    {model.isHistorical ? <section className="notice"><strong>Historical analysis</strong><p>This result applies to an earlier canonical snapshot. The latest snapshot is version {latestSnapshot?.version}.</p>{!archived ? <AnalyseAction businessId={business.id} /> : null}</section> : null}

    {analysis?.run.status === "SUCCEEDED" ? <>
      <section><p className="eyebrow">Analytical findings</p><h2>{model.isHistorical ? "Earlier Evidence Quality result" : `Snapshot ${targetVersion} Evidence Quality`}</h2><p className="muted">Candidate findings for investigation, not canonical facts.</p></section>
      <section><h2>Contradictions</h2>{analysis.contradictions.length ? <div className="record-list">{analysis.contradictions.map((item) => <article className="record-card" key={item.id}><p className="eyebrow">{item.materiality} materiality · {item.area.replaceAll("_", " ")}</p><h3>{item.statement}</h3><p>{item.rationale}</p></article>)}</div> : <p className="empty-state">No material contradictions were identified.</p>}</section>
      <section><h2>Evidence gaps</h2>{analysis.gaps.length ? <div className="record-list">{analysis.gaps.map((item) => <article className="record-card" key={item.id}><p className="eyebrow">{item.materiality} materiality · {item.area.replaceAll("_", " ")}</p><h3>{item.missingInformation}</h3><p>{item.decisionImpact}</p></article>)}</div> : <p className="empty-state">No material evidence gaps were identified.</p>}</section>
      <section><h2>Questions to investigate</h2>{model.surfacedQuestions.length ? <ol className="question-list">{model.surfacedQuestions.map((item) => <li key={item.id}>{item.question}{item.sourceSubmissionId
        ? <span className="muted">Information submitted from this question. It will enter canonical Evidence State only through review.</span>
        : !archived && !model.isHistorical && model.workflow?.state === "GAP_RESOLUTION_REQUIRED"
          ? <Link className="button-link secondary-link" href={`/businesses/${business.id}/information?question=${item.id}`}>Answer this question</Link>
          : <span className="muted">This question belongs to a read-only analysis.</span>}</li>)}</ol> : <p className="empty-state">No high-priority questions were generated.</p>}</section>
    </> : null}
  </main>;
}
