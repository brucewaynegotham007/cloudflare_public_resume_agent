import { AIChatAgent } from "@cloudflare/ai-chat";
import { createWorkersAI } from "workers-ai-provider";
import { convertToModelMessages, isStepCount, streamText, tool } from "ai";
import { routeAgentRequest, callable } from "agents";
import { z } from "zod";
import type { ResumeAgentState } from "./types";
import { AGENT_SYSTEM_PROMPT } from "./prompts";
import { ResumeWorkflow } from "./workflows/resume-workflow";

export { ResumeWorkflow };

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export class ResumeAgent extends AIChatAgent<Env, ResumeAgentState> {
  initialState: ResumeAgentState = {
    status: "idle",
    statusMessage: "Ready. Tell me which job you want to target.",
    taskId: null,
    workflowId: null,
    preferredBranch: "",
    analysis: null,
    resultBranch: null,
    resultUrl: null,
    error: null,
  };

  maxPersistedMessages = 120;
  messageConcurrency = "queue" as const;

  async onStart() {
    this.sql`
      CREATE TABLE IF NOT EXISTS resume_jobs (
        task_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        role_title TEXT,
        base_branch TEXT,
        job_url TEXT,
        result_branch TEXT,
        created_at TEXT NOT NULL
      )
    `;
  }

  async updateFromWorkflow(patch: Partial<ResumeAgentState>) {
    this.setState({ ...this.state, ...patch });
  }

  async recordJob(job: {
    taskId: string;
    status: string;
    roleTitle?: string;
    baseBranch?: string;
    jobUrl?: string | null;
    resultBranch?: string | null;
  }) {
    this.sql`
      INSERT INTO resume_jobs
        (task_id, status, role_title, base_branch, job_url, result_branch, created_at)
      VALUES
        (
          ${job.taskId},
          ${job.status},
          ${job.roleTitle ?? null},
          ${job.baseBranch ?? null},
          ${job.jobUrl ?? null},
          ${job.resultBranch ?? null},
          ${new Date().toISOString()}
        )
      ON CONFLICT(task_id) DO UPDATE SET
        status = excluded.status,
        role_title = excluded.role_title,
        base_branch = excluded.base_branch,
        job_url = excluded.job_url,
        result_branch = excluded.result_branch
    `;
  }

  @callable()
  async setPreferredBranch(branch: string) {
    this.setState({
      ...this.state,
      preferredBranch: branch.trim(),
    });
    return this.state.preferredBranch;
  }

  @callable()
  async approveTask(note = "") {
    if (!this.state.workflowId) {
      throw new Error("There is no resume task waiting for approval.");
    }

    await this.sendWorkflowEvent(
      "RESUME_WORKFLOW",
      this.state.workflowId,
      {
        type: "user-approval",
        payload: { approved: true, note },
      },
    );

    return true;
  }

  @callable()
  async rejectTask() {
    if (!this.state.workflowId) {
      throw new Error("There is no resume task waiting for approval.");
    }

    await this.sendWorkflowEvent(
      "RESUME_WORKFLOW",
      this.state.workflowId,
      {
        type: "user-approval",
        payload: { approved: false },
      },
    );

    return true;
  }

  async onWorkflowError(
    _workflowName: string,
    instanceId: string,
    error: string,
  ) {
    if (instanceId !== this.state.workflowId) return;

    this.setState({
      ...this.state,
      status: "error",
      statusMessage: "The workflow stopped unexpectedly.",
      error,
    });
  }

  async onWorkflowComplete(
    _workflowName: string,
    instanceId: string,
  ) {
    if (instanceId !== this.state.workflowId) return;
  }

  async onChatMessage() {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const result = streamText({
      model: workersai(MODEL),
      system: AGENT_SYSTEM_PROMPT,
      messages: await convertToModelMessages(this.messages),
      tools: {
        start_resume_task: tool({
          description:
            "Start a durable resume-tailoring task. Use this when the user asks to tailor, adapt, rewrite, optimize, or analyze their resume for a target job.",
          inputSchema: z.object({
            request: z.string().min(5),
          }),
          execute: async ({ request }) => {
            const busy = [
              "analyzing",
              "awaiting_approval",
              "generating",
              "running_tools",
            ].includes(this.state.status);

            if (busy) {
              return {
                started: false,
                message:
                  "A resume task is already in progress. Review or reject it before starting another.",
              };
            }

            const taskId = crypto.randomUUID();
            const baseBranch = this.state.preferredBranch.trim() || null;

            this.sql`
              INSERT INTO resume_jobs
                (task_id, status, role_title, base_branch, job_url, result_branch, created_at)
              VALUES
                (${taskId}, ${"queued"}, ${null}, ${baseBranch}, ${null}, ${null}, ${new Date().toISOString()})
            `;

            const workflowId = await this.runWorkflow(
              "RESUME_WORKFLOW",
              {
                taskId,
                request,
                baseBranch,
              },
              { id: taskId, metadata: { kind: "resume-tailoring" } },
            );

            this.setState({
              ...this.state,
              status: "analyzing",
              statusMessage: "Resume task started.",
              taskId,
              workflowId,
              analysis: null,
              resultBranch: null,
              resultUrl: null,
              error: null,
            });

            return {
              started: true,
              taskId,
              workflowId,
            };
          },
        }),
      },
      stopWhen: isStepCount(2),
    });

    return result.toUIMessageStreamResponse();
  }
}

function getCookie(request: Request, name: string) {
  const cookies = request.headers.get("Cookie") ?? "";
  const match = cookies.match(
    new RegExp(`(?:^|;\\s*)${name}=([^;]+)`),
  );
  return match?.[1] ?? null;
}

function authenticated(request: Request, env: Env) {
  return (
    getCookie(request, "resume_session") ===
    env.APP_SESSION_TOKEN
  );
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

async function login(request: Request, env: Env) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const body = (await request.json()) as { password?: string };

  if (!body.password || body.password !== env.APP_PASSWORD) {
    return json({ error: "Invalid password" }, 401);
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "content-type": "application/json",
      "set-cookie":
        `resume_session=${env.APP_SESSION_TOKEN}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`,
    },
  });
}

function logout() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "content-type": "application/json",
      "set-cookie":
        "resume_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0",
    },
  });
}

async function runnerCallback(request: Request, env: Env) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authorization = request.headers.get("Authorization") ?? "";
  if (authorization !== `Bearer ${env.ACTION_CALLBACK_TOKEN}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await request.json();
  const result = z
    .object({
      taskId: z.string(),
      attempt: z.number(),
      retry: z.number(),
      success: z.boolean(),
      errorStage: z
        .enum(["compiler", "validation", "output", "push", "runner"])
        .nullable(),
      compile: z.record(z.string(), z.unknown()).nullable(),
      validation: z.record(z.string(), z.unknown()).nullable(),
      push: z.record(z.string(), z.unknown()).nullable(),
    })
    .parse(body);

  const instance = env.RESUME_WORKFLOW.get(result.taskId);
  await instance.sendEvent({
    type: `runner-result-${result.attempt}-${result.retry}`,
    payload: result,
  });

  return json({ ok: true });
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/login") return login(request, env);
    if (url.pathname === "/api/logout") return logout();
    if (url.pathname === "/api/session") {
      return json({ authenticated: authenticated(request, env) });
    }
    if (url.pathname === "/api/config") {
      if (!authenticated(request, env)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const repo = `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
      return json({ repository: repo, resumeFile: env.RESUME_FILE });
    }
    if (url.pathname === "/api/github-action-callback") {
      return runnerCallback(request, env);
    }

    if (url.pathname.startsWith("/agents/") && !authenticated(request, env)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
