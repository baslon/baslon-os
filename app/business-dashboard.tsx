import Link from "next/link";
import { BusinessCard, type BusinessCardModel } from "./business-card";

export function BusinessesDashboard({ businesses }: { businesses: BusinessCardModel[] }) {
  return <main>
    <nav className="breadcrumbs"><Link href="/">Baslon OS Home</Link> <span aria-hidden="true">/</span> Businesses</nav>
    <section className="dashboard-section">
      <div className="section-heading"><div><h1 className="task-title">Businesses</h1><p className="lede">Choose a business to continue its analysis, or create a new business.</p></div><Link className="button-link" href="/businesses/new">+ New Business</Link></div>
      {businesses.length === 0 ? <div className="empty-state"><h3>No businesses yet</h3><p>Create a business to begin.</p></div> : <div className="business-grid">{businesses.map((business) => <BusinessCard key={business.business.id} model={business} />)}</div>}
      <p><Link href="/businesses/archived">View archived businesses →</Link></p>
    </section>
  </main>;
}
