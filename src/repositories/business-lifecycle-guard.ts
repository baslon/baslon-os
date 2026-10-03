import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { businesses } from "@/db/schema";

export class BusinessArchivedError extends Error {
  constructor() {
    super("This business is archived. Restore it before making strategic changes.");
    this.name = "BusinessArchivedError";
  }
}

/**
 * A protected pilot fixture template refuses ordinary strategic writes.
 *
 * Architecture §4.2: a template's source graph is immutable after approval and it never
 * receives Phase 2 work. Review finding: PR #32 froze only the template *metadata* row, so
 * the template Business's own graph — profile, claims, evidence, submissions, intake,
 * extraction, diagnosis, workflow — accepted every ordinary write.
 *
 * Fixture *instances* are deliberately NOT blocked: they exist to receive work.
 */
export class ProtectedFixtureTemplateError extends Error {
  constructor() {
    super(
      "This business is a protected pilot fixture template. Its approved baseline cannot be "
        + "modified. Create a new template version instead.",
    );
    this.name = "ProtectedFixtureTemplateError";
  }
}

/**
 * The lifecycle and classification gate for strategic writes.
 *
 * Both exported assertions read `business_usage` as well as `status`, so every existing
 * caller inherits template protection without individual changes. The usage read happens
 * in the same statement as the status read, and the locking variant takes `FOR UPDATE`, so
 * a concurrent template registration cannot slip a write past the check.
 */
function evaluate(row: { status: string; businessUsage: string } | undefined) {
  if (!row) throw new Error("Business not found");
  if (row.status !== "active") throw new BusinessArchivedError();
  if (row.businessUsage === "PILOT_FIXTURE_TEMPLATE") throw new ProtectedFixtureTemplateError();
}

export async function assertBusinessActive(database: Database, businessId: string) {
  const [business] = await database.select({
    status: businesses.status,
    businessUsage: businesses.businessUsage,
  }).from(businesses).where(eq(businesses.id, businessId));
  evaluate(business);
}

/**
 * The in-transaction variant.
 *
 * `FOR UPDATE` locks the Business row, which is what makes the classification check
 * race-safe: a template registration must take the same lock to promote the row, so it
 * either commits before this read (and the write is refused) or waits behind it.
 */
export async function assertActiveBusinessForUpdate(
  database: Pick<Database, "select">,
  businessId: string,
) {
  const [business] = await database.select({
    status: businesses.status,
    businessUsage: businesses.businessUsage,
  }).from(businesses).where(eq(businesses.id, businessId)).for("update");
  evaluate(business);
}
