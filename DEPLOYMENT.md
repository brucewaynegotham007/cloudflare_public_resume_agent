# Deployment checklist

This application is designed for a one-user, $0 MVP.

## 1. Prerequisites

- Node.js 22+
- A free Cloudflare account
- A GitHub account
- A private GitHub repository containing `resume.tex` and `resume.pdf`

The current Agents/AI SDK stack uses Node 22+ because AI SDK 7 requires it.

## 2. Create the Cloudflare application

You can use the files in this repository directly, or recreate the official starter and copy these files over:

```bash
npm create cloudflare@latest -- --template=cloudflare/agents-starter
```

For the prepared repository, simply:

```bash
npm install
```

## 3. Configure GitHub repository values

Edit `wrangler.jsonc`:

```json
"GITHUB_OWNER": "your-github-user",
"GITHUB_REPO": "your-private-resume-repo"
```

Do not put a token there.

## 4. Create the GitHub token

Create a fine-grained personal access token restricted to the private resume repo. Give it the minimum access needed for this MVP:

- Contents: Read and write
- Actions: Read and write
- Metadata: Read-only

The token is stored only as a Cloudflare secret.

## 5. Create application secrets

Generate secrets:

```bash
openssl rand -hex 32
```

Then run:

```bash
npx wrangler login
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put APP_PASSWORD
npx wrangler secret put APP_SESSION_TOKEN
npx wrangler secret put ACTION_CALLBACK_TOKEN
```

## 6. Deploy

```bash
npm run deploy
```

The command generates Worker types, builds the Vite application, and deploys the Worker.

Copy the resulting `https://...workers.dev` URL.

## 7. Configure the private resume repo

Copy `.github/workflows/resume-agent-runner.yml` from `private-resume-repo-template` into the private resume repo.

In that private repo, create:

Repository variable:

```text
AGENT_APP_REPO = your-github-user/resume-agent
AGENT_CALLBACK_URL = https://YOUR-WORKER.workers.dev/api/github-action-callback
```

Repository secret:

```text
AGENT_CALLBACK_TOKEN = the same value used for Cloudflare ACTION_CALLBACK_TOKEN
```

## 8. First run

Open the Worker URL.

Enter the application password.

Set a preferred branch or leave it blank.

Send a command such as:

```text
Tailor my resume for https://example.com/jobs/123.
Use my quant branch and keep education unchanged.
```

Review the analysis. Approve generation. The workflow creates a branch, runs the GitHub Action, compiles and validates the PDF, and publishes the result.

## Local development

Browser Run Quick Actions require remote mode during local development:

```bash
npx wrangler dev --remote
```

## Important

- Never commit `.dev.vars`.
- Never expose `GITHUB_TOKEN` to React.
- Keep the actual resume repository private.
- Keep `PROMPT_HISTORY.md` updated with the real AI coding prompts you used.
