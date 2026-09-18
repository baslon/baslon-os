import { desc, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  businessProfiles,
  businesses,
  businessStateSnapshots,
  claimEvidence,
  claims,
  evidence,
  metrics,
} from "@/db/schema";

export async function createCanonicalSnapshot(
  database: Pick<Database, "select" | "insert">,
  businessId: string,
) {
  const [business] = await database.select().from(businesses)
    .where(eq(businesses.id, businessId));
  if (!business) throw new Error("Business not found");
  const [profile] = await database.select().from(businessProfiles)
    .where(eq(businessProfiles.businessId, businessId));
  const businessClaims = await database.select().from(claims)
    .where(eq(claims.businessId, businessId)).orderBy(claims.id);
  const businessEvidence = await database.select().from(evidence)
    .where(eq(evidence.businessId, businessId)).orderBy(evidence.id);
  const businessMetrics = await database.select().from(metrics)
    .where(eq(metrics.businessId, businessId)).orderBy(metrics.id);
  const links = await database.select().from(claimEvidence)
    .where(eq(claimEvidence.businessId, businessId))
    .orderBy(claimEvidence.claimId, claimEvidence.evidenceId);
  const [latest] = await database.select({ version: businessStateSnapshots.version })
    .from(businessStateSnapshots)
    .where(eq(businessStateSnapshots.businessId, businessId))
    .orderBy(desc(businessStateSnapshots.version)).limit(1);
  const [snapshot] = await database.insert(businessStateSnapshots).values({
    businessId,
    version: (latest?.version ?? 0) + 1,
    snapshotData: {
      business,
      profile: profile?.profileData ?? {},
      claims: businessClaims,
      evidence: businessEvidence,
      claimEvidence: links,
      metrics: businessMetrics,
    },
  }).returning();
  return snapshot;
}
