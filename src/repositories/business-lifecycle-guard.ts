import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { businesses } from "@/db/schema";

export class BusinessArchivedError extends Error {
  constructor() {
    super("This business is archived. Restore it before making strategic changes.");
    this.name = "BusinessArchivedError";
  }
}

export async function assertBusinessActive(database: Database, businessId: string) {
  const [business] = await database.select({ status: businesses.status })
    .from(businesses)
    .where(eq(businesses.id, businessId));
  if (!business) throw new Error("Business not found");
  if (business.status !== "active") throw new BusinessArchivedError();
}
