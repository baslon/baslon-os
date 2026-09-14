import Link from "next/link";
import { RestoreBusinessAction } from "./business-lifecycle-actions";

export type ArchivedBusinessModel = {
  business: { id: string; name: string; archivedAt: Date | null };
};

function archivedDate(value: Date | null) {
  return value ? new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  }).format(value) : "Archive date unavailable";
}

export function ArchivedBusinesses({ businesses }: { businesses: ArchivedBusinessModel[] }) {
  return <main>
    <nav className="breadcrumbs"><Link href="/">Baslon OS Home</Link> <span aria-hidden="true">/</span> <Link href="/businesses">Businesses</Link> <span aria-hidden="true">/</span> Archived</nav>
    <section className="dashboard-section">
      <div className="page-header"><h1 className="task-title">Archived businesses</h1><p className="lede">Archived businesses are preserved but cannot be changed until restored.</p></div>
      {businesses.length === 0 ? <p className="empty-state">No archived businesses.</p> : <div className="business-grid">
        {businesses.map(({ business }) => <article className="business-card" key={business.id}>
          <div><h3><Link href={`/businesses/${business.id}`}>{business.name}</Link></h3><p className="muted">Archived {archivedDate(business.archivedAt)}</p></div>
          <div className="card-actions"><Link href={`/businesses/${business.id}`}>View business →</Link><RestoreBusinessAction businessId={business.id} /></div>
        </article>)}
      </div>}
    </section>
  </main>;
}
