export type BusinessProgressInput = {
  workflowState: string;
  latestExtraction?: { id: string; status: "RUNNING" | "SUCCEEDED" | "FAILED" };
  reviewSession?: { id: string; status: "OPEN" | "COMPLETED" };
};

export type BusinessProgress = {
  statusLabel: string;
  statusDescription: string;
  primaryActionLabel: string;
  primaryActionPath: "intake" | "review" | "workspace" | "evidence";
  stages: Array<{ label: string; state: "complete" | "current" | "future" }>;
};

export function deriveBusinessProgress(input: BusinessProgressInput): BusinessProgress {
  const informationComplete = input.workflowState !== "NEW" && input.workflowState !== "INTAKE_IN_PROGRESS";
  const extractionComplete = input.latestExtraction?.status === "SUCCEEDED";
  const reviewComplete = input.reviewSession?.status === "COMPLETED" || input.workflowState === "EVIDENCE_READY";

  let statusLabel = "Business information needed";
  let statusDescription = "Add what you know about this business to begin building its Evidence State.";
  let primaryActionLabel = "Add business information →";
  let primaryActionPath: BusinessProgress["primaryActionPath"] = "intake";

  if (reviewComplete) {
    statusLabel = "Evidence review complete";
    statusDescription = "Your reviewed Evidence State is ready.";
    primaryActionLabel = "View business workspace →";
    primaryActionPath = "workspace";
  } else if (input.reviewSession?.status === "OPEN") {
    statusLabel = "Evidence review in progress";
    statusDescription = "Continue reviewing the proposed business information.";
    primaryActionLabel = "Continue Evidence Review →";
    primaryActionPath = "review";
  } else if (extractionComplete) {
    statusLabel = "Findings ready for review";
    statusDescription = "Baslon OS has prepared proposals that require human review.";
    primaryActionLabel = "Review findings →";
    primaryActionPath = "review";
  } else if (input.latestExtraction?.status === "FAILED") {
    statusLabel = "Information saved";
    statusDescription = "The previous analysis was not completed. Your information is ready to retry.";
    primaryActionLabel = "Analyse business information →";
    primaryActionPath = "intake";
  } else if (informationComplete || input.latestExtraction?.status === "RUNNING") {
    statusLabel = "Information ready for analysis";
    statusDescription = "The business information is ready to be analysed.";
    primaryActionLabel = "Analyse business information →";
    primaryActionPath = "intake";
  }

  const stages: BusinessProgress["stages"] = [
    { label: "Business information", state: informationComplete ? "complete" : "current" },
    { label: "Evidence extraction", state: extractionComplete ? "complete" : informationComplete ? "current" : "future" },
    { label: "Evidence review", state: reviewComplete ? "complete" : extractionComplete ? "current" : "future" },
    { label: "Questions", state: "future" },
    { label: "Diagnosis", state: "future" },
    { label: "Approval", state: "future" },
  ];

  return { statusLabel, statusDescription, primaryActionLabel, primaryActionPath, stages };
}
