import { AIChatAgent } from "@cloudflare/ai-chat";
import { createWorkersAI } from "workers-ai-provider";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  generateText,
  isStepCount,
  tool,
} from "ai";
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
        payload: {
          approved: true,
          note,
        },
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
        payload: {
          approved: false,
        },
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
    console.log("[chat] onChatMessage entered");

    const workersai = createWorkersAI({
      binding: this.env.AI,
    });

    try {
      /*
       * IMPORTANT:
       * We intentionally use generateText() instead of streamText()
       * for the tool-calling step.
       *
       * The previous streamed tool call was reaching the provider as
       * malformed JSON such as:
       *
       * {"request": "{"request": "AnAnalyzealyze ..."}
       *
       * That prevented execute() from ever being entered.
       *
       * generateText() uses the provider's non-streaming tool-call path,
       * avoiding that streamed argument assembly problem.
       */
      const result = await generateText({
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
              console.log("[resume] execute entered", { request });

              try {
                const busy = [
                  "analyzing",
                  "awaiting_approval",
                  "generating",
                  "running_tools",
                ].includes(this.state.status);

                console.log("[resume] busy check", {
                  status: this.state.status,
                  busy,
                });

                if (busy) {
                  return {
                    started: false,
                    message:
                      "A resume task is already in progress. Review or reject it before starting another.",
                  };
                }

                const taskId = crypto.randomUUID();
                const baseBranch =
                  this.state.preferredBranch.trim() || null;

                console.log("[resume] task created", {
                  taskId,
                  baseBranch,
                });

                this.sql`
                  INSERT INTO resume_jobs
                    (
                      task_id,
                      status,
                      role_title,
                      base_branch,
                      job_url,
                      result_branch,
                      created_at
                    )
                  VALUES
                    (
                      ${taskId},
                      ${"queued"},
                      ${null},
                      ${baseBranch},
                      ${null},
                      ${null},
                      ${new Date().toISOString()}
                    )
                `;

                console.log("[resume] SQL insert succeeded");

                console.log("[resume] calling runWorkflow", {
                  taskId,
                  baseBranch,
                });

                const workflowId = await this.runWorkflow(
                  "RESUME_WORKFLOW",
                  {
                    taskId,
                    request,
                    baseBranch,
                  },
                  {
                    id: taskId,
                    metadata: {
                      kind: "resume-tailoring",
                    },
                  },
                );

                console.log("[resume] runWorkflow succeeded", {
                  taskId,
                  workflowId,
                });

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

                console.log("[resume] state updated", {
                  taskId,
                  workflowId,
                });

                return {
                  started: true,
                  taskId,
                  workflowId,
                  message:
                    "The resume-tailoring workflow has been started.",
                };
              } catch (error) {
                console.error("[resume] FAILED", error);

                return {
                  started: false,
                  message: `Resume task failed: ${
                    error instanceof Error
                      ? error.message
                      : String(error)
                  }`,
                };
              }
            },
          }),
        },

        /*
         * Allow the model to make the tool call and then produce
         * a confirmation response after seeing the tool result.
         */
        stopWhen: isStepCount(2),
      });

      console.log("[chat] generateText completed", {
        text: result.text,
        finishReason: result.finishReason,
      });

      /*
       * AIChatAgent expects a UI-message-compatible response.
       *
       * We therefore take the completed generateText() result and
       * package the final text into a UI message stream.
       *
       * The actual resume task has already been started by the tool
       * above, so the workflow/state update is independent of this
       * final chat rendering step.
       */
      const responseText =
        result.text.trim() ||
        (this.state.status === "analyzing"
          ? "I've started the resume-tailoring task. The analysis is now running."
          : "I've processed your request.");

      const stream = createUIMessageStream({
        execute: ({ writer }) => {
          const textId = generateId();

          writer.write({
            type: "text-start",
            id: textId,
          });

          writer.write({
            type: "text-delta",
            id: textId,
            delta: responseText,
          });

          writer.write({
            type: "text-end",
            id: textId,
          });
        },

        onError: (error) => {
          console.error("[chat] UI message stream error", error);

          if (error instanceof Error) {
            return error.message;
          }

          return String(error);
        },
      });

      return createUIMessageStreamResponse({
        stream,
      });
    } catch (error) {
      console.error("[chat] generateText failed", error);

      const errorMessage =
        error instanceof Error
          ? error.message
          : String(error);

      const stream = createUIMessageStream({
        execute: ({ writer }) => {
          const textId = generateId();

          writer.write({
            type: "text-start",
            id: textId,
          });

          writer.write({
            type: "text-delta",
            id: textId,
            delta: `I couldn't start the resume task: ${errorMessage}`,
          });

          writer.write({
            type: "text-end",
            id: textId,
          });
        },

        onError: (streamError) => {
          console.error(
            "[chat] error-response stream failed",
            streamError,
          );

          if (streamError instanceof Error) {
            return streamError.message;
          }

          return String(streamError);
        },
      });

      return createUIMessageStreamResponse({
        stream,
      });
    }
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

  const body = (await request.json()) as {
    password?: string;
  };

  if (!body.password || body.password !== env.APP_PASSWORD) {
    return json({ error: "Invalid password" }, 401);
  }

  return new Response(
    JSON.stringify({ ok: true }),
    {
      headers: {
        "content-type": "application/json",
        "set-cookie":
          `resume_session=${env.APP_SESSION_TOKEN}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`,
      },
    },
  );
}

function logout() {
  return new Response(
    JSON.stringify({ ok: true }),
    {
      headers: {
        "content-type": "application/json",
        "set-cookie":
          "resume_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0",
      },
    },
  );
}

async function runnerCallback(
  request: Request,
  env: Env,
) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authorization =
    request.headers.get("Authorization") ?? "";

  if (
    authorization !==
    `Bearer ${env.ACTION_CALLBACK_TOKEN}`
  ) {
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
        .enum([
          "compiler",
          "validation",
          "output",
          "push",
          "runner",
        ])
        .nullable(),
      compile: z
        .record(z.string(), z.unknown())
        .nullable(),
      validation: z
        .record(z.string(), z.unknown())
        .nullable(),
      push: z
        .record(z.string(), z.unknown())
        .nullable(),
    })
    .parse(body);

  const instance =
    await env.RESUME_WORKFLOW.get(result.taskId);

  await instance.sendEvent({
    type: `runner-result-${result.attempt}-${result.retry}`,
    payload: result,
  });

  return json({ ok: true });
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/login") {
      return login(request, env);
    }

    if (url.pathname === "/api/logout") {
      return logout();
    }

    if (url.pathname === "/api/session") {
      return json({
        authenticated: authenticated(request, env),
      });
    }

    if (url.pathname === "/api/config") {
      if (!authenticated(request, env)) {
        return new Response("Unauthorized", {
          status: 401,
        });
      }

      const repo =
        `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;

      return json({
        repository: repo,
        resumeFile: env.RESUME_FILE,
      });
    }

    if (
      url.pathname ===
      "/api/github-action-callback"
    ) {
      return runnerCallback(request, env);
    }

    if (
      url.pathname.startsWith("/agents/") &&
      !authenticated(request, env)
    ) {
      return new Response("Unauthorized", {
        status: 401,
      });
    }

    const agentResponse =
      await routeAgentRequest(request, env);

    if (agentResponse) {
      return agentResponse;
    }

    return new Response("Not found", {
      status: 404,
    });
  },
} satisfies ExportedHandler<Env>;