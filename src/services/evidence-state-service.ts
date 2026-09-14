import type { EvidenceReviewRepository } from "@/repositories/evidence-review-repository";

export class EvidenceStateService {
  constructor(private readonly repository: EvidenceReviewRepository) {}

  async getCurrent(businessId: string) {
    const data = await this.repository.getEvidenceStateData(businessId);
    const proposalById = new Map(data.proposals.map((proposal) => [proposal.id, proposal]));
    const reviewByCanonicalId = new Map(
      data.reviews
        .filter((review) => review.canonicalEntityId)
        .map((review) => [review.canonicalEntityId!, review]),
    );
    const withLineage = <T extends { id: string }>(item: T) => {
      const review = reviewByCanonicalId.get(item.id);
      return {
        ...item,
        lineage: review ? {
          review,
          proposal: proposalById.get(review.proposalId),
        } : null,
      };
    };
    const groupedClaims = {
      facts: data.claims.filter((claim) => claim.claimType === "fact").map(withLineage),
      observations: data.claims.filter((claim) => claim.claimType === "observation").map(withLineage),
      managementBeliefs: data.claims.filter((claim) => claim.claimType === "management_belief").map(withLineage),
      hypotheses: data.claims.filter((claim) => claim.claimType === "hypothesis").map(withLineage),
      aiInferences: data.claims.filter((claim) => claim.claimType === "ai_inference").map(withLineage),
      unknowns: data.claims.filter((claim) => claim.claimType === "unknown").map(withLineage),
    };
    const relationships = data.relationships.map((relationship) => {
      const review = data.reviews.find((item) => (
        item.canonicalEntityType === "claim_evidence"
        && item.canonicalReference.claimId === relationship.claimId
        && item.canonicalReference.evidenceId === relationship.evidenceId
        && item.canonicalReference.relationshipType === relationship.relationshipType
      ));
      return {
        ...relationship,
        lineage: review ? {
          review,
          proposal: proposalById.get(review.proposalId),
        } : null,
      };
    });
    return {
      business: data.business,
      claims: groupedClaims,
      evidence: data.evidence.map(withLineage),
      metrics: data.metrics.map(withLineage),
      relationships,
    };
  }
}
