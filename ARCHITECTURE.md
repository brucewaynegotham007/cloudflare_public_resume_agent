# Resume Agent architecture

## Runtime

```text
Browser
  |
  | WebSocket chat
  v
Cloudflare AIChatAgent (Durable Object + SQLite)
  |
  +--> Workers AI / Llama 3.3
  |
  +--> Cloudflare Workflow
          |
          +--> GitHub REST API
          |      |
          |      +--> read source resume
          |      +--> create result branch
          |      +--> write candidate resume.tex
          |      +--> dispatch GitHub Actions
          |
          +--> Browser Run (only when normal fetch cannot extract a JD)

GitHub Actions (free execution runner)
  |
  +--> Tectonic compiles resume.tex -> resume.pdf
  +--> Python/pypdf validates exactly one page + text extraction
  +--> valid PDF is committed to the result branch
  +--> callback -> Cloudflare Workflow
```

## Storage boundaries

- GitHub private repository: source-of-truth `resume.tex` and generated `resume.pdf`.
- Agent SQLite: conversation history, current state, preferences, and job metadata.
- GitHub Actions runner: temporary execution filesystem only.

The LLM never receives direct storage credentials. The Worker retrieves data and puts the relevant contents into model context.

## Why GitHub Actions instead of Cloudflare Sandbox?

This repository is intentionally designed for a $0 MVP. Cloudflare Sandbox is not required. GitHub Actions is the execution environment for Python/LaTeX validation.
