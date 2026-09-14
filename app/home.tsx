import Link from "next/link";
import { countNoun } from "@/domain/presentation";

type HomeBusiness = {
  business: { id: string; name: string };
  progress: { statusLabel: string };
  primaryHref: string;
};

type AttentionItem = {
  business: HomeBusiness;
  status: string;
  detail: string;
  actionLabel: string;
};

export type WorkspaceHomeModel = {
  summary: { total: number; awaitingReview: number; failedAnalyses: number; completedReviews: number };
  attention: AttentionItem[];
  recent: HomeBusiness[];
};

export function WorkspaceHome({ model }: { model: WorkspaceHomeModel }) {
  if (model.summary.total === 0) return <main>
    <div className="page-header"><h1 className="task-title">Workspace</h1></div>
    <section className="home-continuation">
      <h2>No businesses yet.</h2>
      <p>Create your first business to begin building an evidence-based business analysis.</p>
      <Link className="button-link" href="/businesses/new">+ New Business</Link>
    </section>
  </main>;

  const summaries = [
    [model.summary.total, countNoun(model.summary.total, "Business", "Businesses")],
    [model.summary.awaitingReview, "Evidence reviews requiring attention"],
    [model.summary.failedAnalyses, "Analysis failures"],
    [model.summary.completedReviews, "Evidence review complete"],
  ] as const;

  return <main>
    <div className="page-header section-heading">
      <div><h1 className="task-title">Workspace</h1><p className="lede">Overview of businesses and work requiring attention.</p></div>
      <Link className="button-link secondary-link" href="/businesses/new">+ New Business</Link>
    </div>

    <section aria-labelledby="workspace-overview-heading">
      <h2 id="workspace-overview-heading">Workspace overview</h2>
      <div className="summary-grid">{summaries.map(([value, label]) => <article className="summary-card" key={label}><strong>{value}</strong><span>{label}</span></article>)}</div>
    </section>

    <section aria-labelledby="attention-heading">
      <h2 id="attention-heading">Work requiring attention</h2>
      {model.attention.length > 0 ? <div className="attention-list">{model.attention.map((item) => <article className="attention-card" key={item.business.business.id}>
        <div><h3>{item.business.business.name}</h3><p className="status-label">{item.status}</p><p className="muted">{item.detail}</p></div>
        <Link className="button-link" href={item.business.primaryHref}>{item.actionLabel}</Link>
      </article>)}</div> : <div className="empty-state"><p>Nothing currently needs review.</p></div>}
    </section>

    {model.recent.length > 0 ? <section className="recent-businesses" aria-labelledby="recent-businesses-heading">
      <div className="section-heading"><h2 id="recent-businesses-heading">Recently active businesses</h2><Link href="/businesses">View all businesses →</Link></div>
      <div className="recent-list">{model.recent.map((business) => <article key={business.business.id}>
        <div><h3>{business.business.name}</h3><p className="muted">{business.progress.statusLabel}</p></div>
        <Link href={`/businesses/${business.business.id}`}>Open →</Link>
      </article>)}</div>
    </section> : null}
  </main>;
}
