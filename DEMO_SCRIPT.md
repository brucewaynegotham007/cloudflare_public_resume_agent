# 2-minute demo script

1. Log into the workspace.
2. Show the connected private GitHub repo and the preferred base branch.
3. Submit a real or sample job URL.
4. Explain that the Agent resolves the job page, loads the chosen resume branch, and asks Llama to produce a structured fit analysis.
5. Show the analysis and approval gate.
6. Click `Approve & generate`.
7. Show Workflow status progressing through candidate generation, GitHub branch creation, and deterministic validation.
8. If validation fails, point out that the Workflow feeds the machine-readable failure back into the LLM for a bounded repair iteration.
9. When complete, open the GitHub result branch and show the generated `resume.tex` and `resume.pdf`.
10. End by pointing out that GitHub is the source of truth, SQLite stores agent state, and GitHub Actions is the free execution environment.
