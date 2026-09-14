import Link from "next/link";
import { createBusinessAction } from "../../actions";

export default function NewBusinessPage() {
  return <main className="narrow">
    <nav className="breadcrumbs"><Link href="/businesses">Businesses</Link> <span aria-hidden="true">/</span> New Business</nav>
    <p className="eyebrow">New Business</p>
    <h1 className="task-title">Create a business</h1>
    <p className="lede">Add the basic details needed to start building an Evidence State.</p>
    <section className="panel">
      <form action={createBusinessAction} className="stacked-form">
        <label>Name<input name="name" required /></label>
        <label>Legal name <span className="field-note">Optional</span><input name="legalName" /></label>
        <label>Website <span className="field-note">Optional</span><input name="websiteUrl" type="url" /></label>
        <label>Sector <span className="field-note">Optional</span><input name="sector" /></label>
        <label>Primary geography <span className="field-note">Optional</span><input name="primaryGeography" /></label>
        <div className="button-row"><button type="submit">Create Business</button><Link href="/businesses">Cancel</Link></div>
      </form>
    </section>
  </main>;
}
