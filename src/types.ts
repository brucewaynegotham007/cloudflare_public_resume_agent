import { z } from "zod";

export const ResumeSuggestionSchema = z.object({
  section: z.string(),
  current: z.string(),
  proposed: z.string(),
  reason: z.string(),
});

export const ResumeAnalysisSchema = z.object({
  roleTitle: z.string(),
  summary: z.string(),
  strongMatches: z.array(z.string()).max(8),
  improvementAreas: z.array(z.string()).max(8),
  suggestions: z.array(ResumeSuggestionSchema).max(8),
});

export type ResumeAnalysis = z.infer<typeof ResumeAnalysisSchema>;

export type ResumeStatus =
  | "idle"
  | "analyzing"
  | "awaiting_approval"
  | "generating"
  | "running_tools"
  | "complete"
  | "rejected"
  | "error";

export type ResumeAgentState = {
  status: ResumeStatus;
  statusMessage: string;
  taskId: string | null;
  workflowId: string | null;
  preferredBranch: string;
  analysis: ResumeAnalysis | null;
  resultBranch: string | null;
  resultUrl: string | null;
  error: string | null;
};

export type ResumeWorkflowParams = {
  taskId: string;
  request: string;
  baseBranch?: string | null;
};

export type GitHubActionResult = {
  taskId: string;
  attempt: number;
  retry: number;
  success: boolean;
  errorStage: "compiler" | "validation" | "output" | "push" | "runner" | null;
  compile: Record<string, unknown> | null;
  validation: Record<string, unknown> | null;
  push: Record<string, unknown> | null;
};
