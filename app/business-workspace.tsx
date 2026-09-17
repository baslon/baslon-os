import Link from "next/link";
import type { BusinessProgress } from "@/domain/business-progress";
import { countNoun } from "@/domain/presentation";
import {
  formatWorkspaceMetric,
  formatWorkspaceMetricPeriod,
  type WorkspaceMetricPresentation,
} from "@/domain/workspace-metrics";
import { ArchiveBusinessAction, RestoreBusinessAction } from "./business-lifecycle-actions";

export type WorkspaceMetric = WorkspaceMetricPresentation;

export type WorkspaceModel = {
  business: {
    id: string;
    name: string;
    sector: string | null;
    primaryGeography: string | null;
    status: string;
    archivedAt: Date | null;
  };
  progress: BusinessProgress;
  primaryHref: string;
  activeReviewHref?: string;
  canAddInformation: boolean;
  counts: Array<{ singular: string; plural: string; value: number }>;
  metrics: WorkspaceMetric[];
};

export function BusinessWorkspace({ model }: { model: WorkspaceModel }) {
  const metadata = [model.business.sector, model.business.primaryGeography].filter(Boolean).join(" · ");
  const archived = model.business.status === "archived";
  return <main>
    <nav className="breadcrumbs"><Link href="/businesses">Businesses</Link> <span aria-hidden="true">/</span> {model.business.name}</nav>
    <p className="context-name">{model.business.name}</p>
    {metadata ? <p className="muted business-meta">{metadata}</p> : null}
    <h1 className="task-title">Business Workspace</h1>

    <section aria-labelledby="progress-heading">
      <h2 id="progress-heading">Analysis progress</h2>
      <ol className="stepper">
        {model.progress.stages.map((stage) => <li className={`step-${stage.state}`} key={stage.label}>
          <span aria-hidden="true">{stage.state === "complete" ? "✓" : "○"}</span>
          <span>{stage.label}</span>
          <span className="sr-only"> — {stage.state === "future" ? "not available yet" : stage.state}</span>
        </li>)}
      </ol>
    </section>

    <section className={`status-panel${archived ? " archived-status" : ""}`}>
      <p className="eyebrow">Current status</p>
      {archived ? <>
        <h2>Archived business</h2>
        <p>This business is read-only while archived. Its analysis history has been preserved. Restore it to continue working on the analysis.</p>
        <RestoreBusinessAction businessId={model.business.id} />
      </> : <>
        <h2>{model.progress.statusLabel}</h2>
        <p>{model.progress.statusDescription}</p>
        <Link className="button-link" href={model.primaryHref}>{model.progress.primaryActionLabel}</Link>
      </>}
    </section>

    <section>
      <div className="section-heading"><h2>Current Evidence State</h2><Link href={`/businesses/${model.business.id}/evidence`}>View all →</Link></div>
      <div className="summary-grid">{model.counts.map((count) => <article className="summary-card" key={count.plural}>
        <strong>{count.value}</strong><span>{countNoun(count.value, count.singular, count.plural)}</span>
      </article>)}</div>
    </section>

    {model.metrics.length > 0 ? <section>
      <h2>Key metrics</h2>
      <div className="metric-grid">{model.metrics.map((metric) => <article className="metric-card" key={metric.id}>
        <p>{metric.metricLabel}</p><strong>{formatWorkspaceMetric(metric)}</strong>
        {formatWorkspaceMetricPeriod(metric.periodStart, metric.periodEnd) ? <span className="muted">{formatWorkspaceMetricPeriod(metric.periodStart, metric.periodEnd)}</span> : null}
      </article>)}</div>
    </section> : null}

    {!archived ? <>
      <section className="secondary-actions" aria-label="Business actions">
        <Link className="button-link secondary-link" href={`/businesses/${model.business.id}/evidence-quality`}>Evidence Quality</Link>
        {model.canAddInformation ? <Link className="button-link secondary-link" href={`/businesses/${model.business.id}/information`}>Add Information</Link> : null}
        {model.activeReviewHref ? <Link className="button-link" href={model.activeReviewHref}>Continue Evidence Review</Link> : null}
      </section>
      <section className="business-management" aria-labelledby="business-management-heading">
        <h2 id="business-management-heading">Business management</h2>
        <p>Archiving removes this business from active work but preserves all of its data and history.</p>
        <ArchiveBusinessAction businessId={model.business.id} businessName={model.business.name} />
      </section>
    </> : <section className="danger-zone" aria-labelledby="danger-zone-heading">
      <p className="eyebrow danger-text">Danger zone</p>
      <h2 id="danger-zone-heading">Permanently delete business</h2>
      <p>This permanently deletes this business and all of its analysis data. This cannot be undone.</p>
      <Link className="button-link danger-link" href={`/businesses/${model.business.id}/delete`}>Permanently delete business</Link>
    </section>}
  </main>;
}
