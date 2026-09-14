import Link from "next/link";
import { createBusinessAction } from "./actions";
import { getBusinessService } from "@/foundation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const businesses = await getBusinessService().list();

  return (
    <main>
      <p className="eyebrow">Milestone 2B · Human Evidence Review</p>
      <h1>Baslon OS</h1>
      <p className="lede">Turn messy business intake into human-reviewed, traceable Evidence State.</p>

      <section>
        <h2>Businesses</h2>
        {businesses.length === 0 ? <p>No businesses yet.</p> : (
          <ul className="business-list">
            {businesses.map((business) => (
              <li key={business.id}>
                <strong>{business.name}</strong>
                <span>
                  <Link href={`/businesses/${business.id}/intake`}>Enter intake</Link>
                  {" · "}
                  <Link href={`/businesses/${business.id}/evidence`}>Evidence State</Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Create Business</h2>
        <form action={createBusinessAction} className="stacked-form">
          <label>Name<input name="name" required /></label>
          <label>Legal name<input name="legalName" /></label>
          <label>Website<input name="websiteUrl" type="url" /></label>
          <label>Sector<input name="sector" /></label>
          <label>Primary geography<input name="primaryGeography" /></label>
          <button type="submit">Create Business</button>
        </form>
      </section>
    </main>
  );
}
