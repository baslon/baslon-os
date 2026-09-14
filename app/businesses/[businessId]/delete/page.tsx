import { notFound } from "next/navigation";
import Link from "next/link";
import { getBusinessService } from "@/foundation";
import { displayDomain } from "@/domain/business-deletion";
import { PermanentDeleteConfirmation } from "../../../permanent-delete-confirmation";

export const dynamic = "force-dynamic";

export default async function PermanentDeleteBusinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { businessId } = await params;
  const { error } = await searchParams;
  const businessService = getBusinessService();
  const business = await businessService.getIncludingArchived(businessId);
  if (!business) notFound();
  if (business.status !== "archived") return <main className="narrow">
    <nav className="breadcrumbs"><Link href="/businesses">Businesses</Link> <span aria-hidden="true">/</span> <Link href={`/businesses/${business.id}`}>{business.name}</Link> <span aria-hidden="true">/</span> Permanent delete</nav>
    <h1 className="task-title">Archive this business first</h1>
    <p className="lede">Business must be archived before it can be permanently deleted.</p>
    <Link className="button-link" href={`/businesses/${business.id}`}>Return to business</Link>
  </main>;
  const confirmation = await businessService.getPermanentDeleteConfirmation(businessId);
  return <PermanentDeleteConfirmation
    businessId={business.id}
    businessName={business.name}
    phrase={confirmation.phrase}
    duplicateName={confirmation.duplicateName}
    website={displayDomain(business.websiteUrl)}
    geography={business.primaryGeography}
    error={error}
  />;
}
