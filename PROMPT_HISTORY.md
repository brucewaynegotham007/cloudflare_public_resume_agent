# AI-assisted coding prompt history

Cloudflare's application assignment asks for prompt history. Keep the real prompts you use while developing this project here.

Do not paste secrets, tokens, private resume contents, or private job-application information into this file.

## Example entry

### 2026-09-25 - Workflow architecture

Prompt:

> Explain how to make a Cloudflare Agent start a durable Workflow, wait for a human approval event, and resume after approval.

What changed:

- Used `runWorkflow()` from the Agent.
- Used `step.waitForEvent()` inside the Workflow.
- Used `sendWorkflowEvent()` from the Agent approval method.

Result:

- Added the approval gate to `src/workflows/resume-workflow.ts`.
