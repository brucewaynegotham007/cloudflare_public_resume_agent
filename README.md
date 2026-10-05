# Resume Agent

A single-user Cloudflare AI Agent that takes a natural-language resume request, analyzes a target job, prepares a LaTeX revision, validates the generated PDF with deterministic tools, and publishes an approved result to a GitHub branch.

## Requirements implemented

- LLM: Cloudflare Workers AI + Llama 3.3 70B.
- Workflow / coordination: Cloudflare Workflows.
- User input: React chat connected to an `AIChatAgent` over WebSockets.
- Memory/state: Agents SQLite + persisted chat history.
- External application: private GitHub repository.
- Deterministic tools: Python + Tectonic + pypdf in GitHub Actions.
- Human approval before candidate generation.
- Bounded model repair loop after compiler/validation failures.
- Infrastructure retry for GitHub publish failures.

## $0 design

Cloudflare Sandbox is intentionally not used. The Python/LaTeX execution happens in the GitHub Actions runner of the private resume repository.

## Two repositories

### 1. `resume-agent`

Public application repository containing the Cloudflare Worker, Agent, Workflow, frontend, prompts, and tool scripts.

### 2. `private-resume-repo`

Private source-of-truth repository containing:

```text
resume.tex
resume.pdf
.github/workflows/resume-agent-runner.yml
```

The application retrieves the LaTeX source through the GitHub API. The model never receives the GitHub token.

## Important current platform notes

Cloudflare's current Agents starter uses `AIChatAgent`, `useAgentChat`, Durable Objects with SQLite, and the Agents Vite plugin. The current AI SDK 7 line requires Node 22+, and Workers AI provides the Cloudflare-hosted Llama 3.3 model used here.

See `DEPLOYMENT.md` for the exact setup.
