export type CustomToolRenderingStage =
  | "install"
  | "registry"
  | "definition"
  | "activity"
  | "renderCall"
  | "renderResult";

export type CustomToolRenderingIssue = {
  stage: CustomToolRenderingStage;
  error: unknown;
  toolName?: string;
};

export type CustomToolRenderingReporter = (
  issue: CustomToolRenderingIssue,
) => void;
