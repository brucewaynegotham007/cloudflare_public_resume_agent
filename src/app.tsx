import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { ResumeAgent } from "./server";
import type { ResumeAgentState } from "./types";
import "./app.css";

type AppConfig = {
  repository: string;
  resumeFile: string;
};

type View = "request" | "review" | "execute" | "result";

type ChatPart = {
  type?: string;
  text?: string;
  [key: string]: unknown;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | string;
  parts?: ChatPart[];
};

const VIEW_ORDER: View[] = [
  "request",
  "review",
  "execute",
  "result",
];

const VIEW_META: Record<
  View,
  { label: string; number: string }
> = {
  request: {
    label: "Request",
    number: "01",
  },
  review: {
    label: "Review",
    number: "02",
  },
  execute: {
    label: "Execute",
    number: "03",
  },
  result: {
    label: "Result",
    number: "04",
  },
};

function statusLabel(status: string) {
  switch (status) {
    case "analyzing":
      return "Analyzing";
    case "awaiting_approval":
      return "Awaiting review";
    case "generating":
      return "Generating";
    case "running_tools":
      return "Building";
    case "complete":
      return "Complete";
    case "error":
      return "Error";
    default:
      return "Ready";
  }
}

function viewForStatus(status: string): View {
  switch (status) {
    case "awaiting_approval":
      return "review";
    case "generating":
    case "running_tools":
      return "execute";
    case "complete":
      return "result";
    default:
      return "request";
  }
}

function shortId(value?: string | null): string {
  if (!value) return "—";
  return value.slice(0, 12);
}

function CopyButton({
  value,
}: {
  value?: string | null;
}) {
  const [copied, setCopied] = useState(false);

  if (!value) return null;

  async function copy() {
    const copyValue = value;

    if (!copyValue) return;

    try {
      await navigator.clipboard.writeText(copyValue);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      className="copy-button"
      onClick={copy}
      title="Copy"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Login                                                                      */
/* -------------------------------------------------------------------------- */

function Login({
  onLogin,
}: {
  onLogin: () => void;
}) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (!password.trim()) {
      setError("Enter the workspace password.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        setError("Invalid workspace password.");
        return;
      }

      onLogin();
    } catch {
      setError("Could not reach the workspace.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-grid" />

      <form className="login-card" onSubmit={submit}>
        <div className="brand-symbol">R</div>

        <div className="eyebrow">RESUME AGENT</div>

        <h1>
          Tailor the resume.
          <br />
          Keep control.
        </h1>

        <p>
          Analyze a role, inspect the proposed changes, approve the
          revision, and let the execution pipeline take it from there.
        </p>

        <label htmlFor="password">
          Workspace password
        </label>

        <input
          id="password"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(event) =>
            setPassword(event.target.value)
          }
          placeholder="Enter password"
        />

        <button
          type="submit"
          className="primary-button"
          disabled={loading}
        >
          {loading ? "Opening..." : "Open workspace"}
          <span>↗</span>
        </button>

        {error && (
          <div className="form-error">
            {error}
          </div>
        )}
      </form>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Sidebar                                                                    */
/* -------------------------------------------------------------------------- */

function Sidebar({
  activeView,
  setActiveView,
  state,
  config,
  branch,
  setBranch,
  saveBranch,
  logout,
}: {
  activeView: View;
  setActiveView: (view: View) => void;
  state: ResumeAgentState | null;
  config: AppConfig | null;
  branch: string;
  setBranch: (value: string) => void;
  saveBranch: () => Promise<void>;
  logout: () => Promise<void>;
}) {
  const canReview = Boolean(state?.analysis);
  const canResult = state?.status === "complete";

  const status = state?.status ?? "idle";

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brand-lockup">
          <div className="brand-symbol small">R</div>
          <div>
            <div className="brand-name">Resume Agent</div>
            <div className="brand-subtitle">
              Private workspace
            </div>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label">WORKFLOW</div>

          <nav className="workflow-nav">
            {VIEW_ORDER.map((view) => {
              const enabled =
                view === "request" ||
                view === "execute" ||
                (view === "review" && canReview) ||
                (view === "result" && canResult);

              const active = activeView === view;

              return (
                <button
                  key={view}
                  type="button"
                  className={`nav-item ${active ? "active" : ""} ${!enabled ? "locked" : ""}`}
                  disabled={!enabled}
                  onClick={() => setActiveView(view)}
                >
                  <span className="nav-number">
                    {VIEW_META[view].number}
                  </span>

                  <span className="nav-label">
                    {VIEW_META[view].label}
                  </span>

                  {view === "review" && canReview && (
                    <span className="nav-badge">
                      Ready
                    </span>
                  )}

                  {view === "result" && canResult && (
                    <span className="nav-badge success">
                      Ready
                    </span>
                  )}

                  {!enabled && (
                    <span className="nav-lock">
                      ·
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-section source-section">
          <div className="sidebar-label">
            SOURCE
          </div>

          <div className="source-repo">
            <div className="source-icon">⌘</div>
            <div className="source-copy">
              <strong>
                {config?.repository ?? "Loading..."}
              </strong>
              <span>
                {config?.resumeFile ?? "resume.tex"}
              </span>
            </div>
          </div>

          <label htmlFor="base-branch">
            Base branch
          </label>

          <div className="branch-input">
            <input
              id="base-branch"
              value={branch}
              onChange={(event) =>
                setBranch(event.target.value)
              }
              placeholder="main"
            />

            <button
              type="button"
              onClick={saveBranch}
            >
              Save
            </button>
          </div>

          <p>
            Leave blank to use the repository default.
          </p>
        </div>
      </div>

      <div className="sidebar-bottom">
        <div className="connection-status">
          <span className="status-dot live" />
          <div>
            <strong>
              {status === "idle"
                ? "Agent ready"
                : statusLabel(status)}
            </strong>
            <span>
              Persistent session
            </span>
          </div>
        </div>

        <button
          type="button"
          className="lock-button"
          onClick={logout}
        >
          Lock workspace
        </button>
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/* Workflow header                                                            */
/* -------------------------------------------------------------------------- */

function WorkflowHeader({
  state,
  activeView,
}: {
  state: ResumeAgentState | null;
  activeView: View;
}) {
  const status = state?.status ?? "idle";
  const live =
    status !== "idle" &&
    status !== "complete" &&
    status !== "error";

  return (
    <header className="content-header">
      <div>
        <div className="breadcrumb">
          WORKSPACE
          <span>/</span>
          {VIEW_META[activeView].label.toUpperCase()}
        </div>

        <h1>
          {activeView === "request" &&
            "What are we targeting?"}

          {activeView === "review" &&
            "Review the proposed revision"}

          {activeView === "execute" &&
            "Watch the candidate being built"}

          {activeView === "result" &&
            "The candidate is ready"}
        </h1>

        <p>
          {activeView === "request" &&
            "Describe the role and let the agent do the first pass."}

          {activeView === "review" &&
            "Nothing is generated until you approve the changes."}

          {activeView === "execute" &&
            "The approved candidate is being compiled and validated."}

          {activeView === "result" &&
            "The validated LaTeX and PDF are available on GitHub."}
        </p>
      </div>

      <div className="header-status">
        <span className={`status-dot ${live ? "live" : ""}`} />
        <span>{statusLabel(status)}</span>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Progress                                                                   */
/* -------------------------------------------------------------------------- */

function ProgressBar({
  activeView,
  state,
}: {
  activeView: View;
  state: ResumeAgentState | null;
}) {
  const status = state?.status ?? "idle";

  let completed = -1;

  if (status === "analyzing") {
    completed = -1;
  } else if (status === "awaiting_approval") {
    completed = 0;
  } else if (
    status === "generating" ||
    status === "running_tools"
  ) {
    completed = 1;
  } else if (status === "complete") {
    completed = 3;
  }

  const activeIndex =
    VIEW_ORDER.indexOf(activeView);

  return (
    <div className="progress-shell">
      {VIEW_ORDER.map((view, index) => {
        const done =
          index <= completed;

        const active =
          index === activeIndex;

        return (
          <div
            className={`progress-step ${done ? "done" : ""} ${active ? "active" : ""}`}
            key={view}
          >
            <div className="progress-marker">
              {done ? "✓" : VIEW_META[view].number}
            </div>
            <span>
              {VIEW_META[view].label}
            </span>

            {index !== VIEW_ORDER.length - 1 && (
              <div className="progress-connector" />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Chat                                                                      */
/* -------------------------------------------------------------------------- */

function ChatView({
  agent,
  state,
}: {
  agent: any;
  state: ResumeAgentState | null;
}) {
  const chat = useAgentChat({ agent });
  const [draft, setDraft] = useState("");
  const messagesRef = useRef<HTMLDivElement | null>(
    null,
  );

  const messages =
    (chat.messages ?? []) as ChatMessage[];

  const busy =
    chat.status === "streaming" ||
    chat.status === "submitted";

  const taskRunning = [
    "analyzing",
    "awaiting_approval",
    "generating",
    "running_tools",
  ].includes(state?.status ?? "");

  useEffect(() => {
    const node = messagesRef.current;

    if (!node) return;

    node.scrollTo({
      top: node.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, chat.status]);

  async function send(event: FormEvent) {
    event.preventDefault();

    const text = draft.trim();

    if (!text || busy || taskRunning) {
      return;
    }

    setDraft("");

    try {
      await chat.sendMessage({ text });
    } catch {
      setDraft(text);
    }
  }

  function usePrompt(prompt: string) {
    setDraft(prompt);

    window.setTimeout(() => {
      document
        .getElementById("resume-composer")
        ?.focus();
    }, 0);
  }

  return (
    <div className="request-layout">
      <section className="conversation-panel">
        <div className="conversation-toolbar">
          <div>
            <div className="section-kicker">
              AGENT CONVERSATION
            </div>

            <div className="conversation-title">
              {messages.length === 0
                ? "Start with a target role"
                : `${messages.length} message${messages.length === 1 ? "" : "s"}`}
            </div>
          </div>

          <div className="conversation-meta">
            WebSocket · persistent
          </div>
        </div>

        <div
          className="messages"
          ref={messagesRef}
        >
          {messages.length === 0 && (
            <div className="conversation-empty">
              <div className="empty-mark">
                <span>R</span>
              </div>

              <h2>
                Tell me what you're applying for.
              </h2>

              <p>
                Paste a job description, provide a job URL,
                or describe the role and constraints in your
                own words.
              </p>

              <div className="prompt-list">
                <button
                  type="button"
                  onClick={() =>
                    usePrompt(
                      "Tailor my resume for a Software Engineer role. I will provide the job description next.",
                    )
                  }
                >
                  <span>01</span>
                  Software Engineer targeting
                </button>

                <button
                  type="button"
                  onClick={() =>
                    usePrompt(
                      "Analyze this job description against my resume and suggest the highest-value changes. Do not generate anything yet.",
                    )
                  }
                >
                  <span>02</span>
                  Analyze a job description
                </button>

                <button
                  type="button"
                  onClick={() =>
                    usePrompt(
                      "Tailor my resume using my preferred branch and preserve my education section unchanged.",
                    )
                  }
                >
                  <span>03</span>
                  Apply a specific constraint
                </button>
              </div>
            </div>
          )}

          {messages.map((message) => {
            const textParts =
              message.parts?.filter(
                (part) =>
                  part.type === "text" &&
                  Boolean(part.text),
              ) ?? [];

            if (textParts.length === 0) {
              return null;
            }

            const isUser =
              message.role === "user";

            return (
              <div
                className={`chat-message ${isUser ? "user" : "assistant"}`}
                key={message.id}
              >
                <div className="message-label">
                  {isUser
                    ? "YOU"
                    : "RESUME AGENT"}
                </div>

                <div className="message-content">
                  {textParts.map(
                    (part, index) => (
                      <p
                        key={`${message.id}-${index}`}
                      >
                        {part.text}
                      </p>
                    ),
                  )}
                </div>
              </div>
            );
          })}

          {busy && (
            <div className="chat-message assistant">
              <div className="message-label">
                RESUME AGENT
              </div>

              <div className="thinking">
                <span />
                <span />
                <span />
                <em>
                  Working on it…
                </em>
              </div>
            </div>
          )}
        </div>

        <div className="composer-wrap">
          {taskRunning && (
            <div className="composer-lock">
              <span className="status-dot live" />
              {state?.statusMessage}
            </div>
          )}

          <form
            className="composer"
            onSubmit={send}
          >
            <textarea
              id="resume-composer"
              value={draft}
              onChange={(event) =>
                setDraft(event.target.value)
              }
              disabled={
                busy || taskRunning
              }
              placeholder={
                taskRunning
                  ? "The current task is running..."
                  : "Tell the agent what to target..."
              }
              rows={4}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />

            <div className="composer-bottom">
              <span>
                Enter to send · Shift + Enter for a new line
              </span>

              <button
                type="submit"
                className="send-button"
                disabled={
                  busy ||
                  taskRunning ||
                  !draft.trim()
                }
              >
                {busy ? "Working..." : "Send"}
                <span>↗</span>
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="request-explainer">
        <div className="section-kicker">
          HOW IT WORKS
        </div>

        <div className="explainer-row">
          <span>01</span>
          <div>
            <strong>Describe the role</strong>
            <p>
              Give the agent the job description,
              URL, or targeting constraints.
            </p>
          </div>
        </div>

        <div className="explainer-row">
          <span>02</span>
          <div>
            <strong>Inspect the analysis</strong>
            <p>
              The agent identifies matches, gaps,
              and proposed resume changes.
            </p>
          </div>
        </div>

        <div className="explainer-row">
          <span>03</span>
          <div>
            <strong>Approve the execution</strong>
            <p>
              A new candidate is generated only after
              your explicit approval.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Review                                                                     */
/* -------------------------------------------------------------------------- */

function ReviewView({
  state,
  agent,
}: {
  state: ResumeAgentState;
  agent: any;
}) {
  const analysis = state.analysis;

  const [note, setNote] = useState("");
  const [action, setAction] = useState<
    "idle" | "approving" | "rejecting"
  >("idle");

  if (!analysis) {
    return (
      <EmptyStage
        title="Nothing to review yet"
        description="Start a request first. The analysis will appear here before anything is generated."
      />
    );
  }

  async function approve() {
    setAction("approving");

    try {
      await agent.stub.approveTask(note);
    } finally {
      setAction("idle");
    }
  }

  async function reject() {
    setAction("rejecting");

    try {
      await agent.stub.rejectTask();
    } finally {
      setAction("idle");
    }
  }

  return (
    <div className="review-layout">
      <section className="analysis-hero">
        <div>
          <div className="section-kicker">
            TARGET ROLE
          </div>

          <h2>{analysis.roleTitle}</h2>

          <p>{analysis.summary}</p>
        </div>

        <div className="analysis-count-box">
          <strong>
            {analysis.suggestions.length}
          </strong>
          <span>
            proposed changes
          </span>
        </div>
      </section>

      <div className="review-columns">
        <div className="review-main">
          <section className="content-card">
            <div className="card-heading">
              <div>
                <div className="section-kicker">
                  STRONG MATCHES
                </div>
                <h3>
                  Where your resume already fits
                </h3>
              </div>
            </div>

            <div className="tag-grid">
              {analysis.strongMatches.map(
                (item) => (
                  <div
                    className="tag positive"
                    key={item}
                  >
                    <span>✓</span>
                    {item}
                  </div>
                ),
              )}
            </div>
          </section>

          <section className="content-card">
            <div className="card-heading">
              <div>
                <div className="section-kicker">
                  IMPROVEMENT AREAS
                </div>
                <h3>
                  What needs more emphasis
                </h3>
              </div>
            </div>

            <div className="tag-grid">
              {analysis.improvementAreas.map(
                (item) => (
                  <div
                    className="tag"
                    key={item}
                  >
                    {item}
                  </div>
                ),
              )}
            </div>
          </section>

          <section className="content-card">
            <div className="card-heading">
              <div>
                <div className="section-kicker">
                  PROPOSED CHANGES
                </div>
                <h3>
                  Before you approve anything
                </h3>
              </div>

              <span className="quiet-count">
                {analysis.suggestions.length}
              </span>
            </div>

            <div className="change-list">
              {analysis.suggestions.map(
                (item, index) => (
                  <article
                    className="change-item"
                    key={`${item.section}-${index}`}
                  >
                    <div className="change-heading">
                      <div className="change-index">
                        {String(
                          index + 1,
                        ).padStart(2, "0")}
                      </div>

                      <div>
                        <strong>
                          {item.section}
                        </strong>
                        <p>
                          {item.reason}
                        </p>
                      </div>
                    </div>

                    <div className="change-grid">
                      <div className="change-side current">
                        <span>
                          CURRENT
                        </span>
                        <p>
                          {item.current}
                        </p>
                      </div>

                      <div className="change-arrow">
                        →
                      </div>

                      <div className="change-side proposed">
                        <span>
                          PROPOSED
                        </span>
                        <p>
                          {item.proposed}
                        </p>
                      </div>
                    </div>
                  </article>
                ),
              )}
            </div>
          </section>
        </div>

        <aside className="approval-card">
          <div className="section-kicker">
            HUMAN APPROVAL
          </div>

          <h3>
            Ready to generate?
          </h3>

          <p>
            Approval creates the candidate branch and
            starts the execution pipeline. Your base
            resume remains untouched.
          </p>

          <label htmlFor="approval-note">
            Instructions for generation
          </label>

          <textarea
            id="approval-note"
            value={note}
            onChange={(event) =>
              setNote(event.target.value)
            }
            rows={6}
            placeholder="Optional. For example: preserve education exactly and prioritize systems experience."
            disabled={action !== "idle"}
          />

          <button
            type="button"
            className="approve-button-large"
            onClick={approve}
            disabled={action !== "idle"}
          >
            {action === "approving"
              ? "Approving..."
              : "Approve & generate"}
            <span>↗</span>
          </button>

          <button
            type="button"
            className="reject-button"
            onClick={reject}
            disabled={action !== "idle"}
          >
            {action === "rejecting"
              ? "Rejecting..."
              : "Reject"}
          </button>

          <div className="approval-note">
            The workflow pauses here by design.
          </div>
        </aside>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Execute                                                                    */
/* -------------------------------------------------------------------------- */

function ExecuteView({
  state,
}: {
  state: ResumeAgentState | null;
}) {
  const status = state?.status ?? "idle";

  const stages = [
    {
      key: "analysis",
      label: "Role analysis",
      description:
        "The target role is compared against the base resume.",
      active:
        status === "analyzing",
      done:
        status === "awaiting_approval" ||
        status === "generating" ||
        status === "running_tools" ||
        status === "complete",
    },
    {
      key: "approval",
      label: "Human approval",
      description:
        "The proposed revision is reviewed before generation.",
      active:
        status === "awaiting_approval",
      done:
        status === "generating" ||
        status === "running_tools" ||
        status === "complete",
    },
    {
      key: "generation",
      label: "Candidate generation",
      description:
        "The approved changes are written to a new branch.",
      active:
        status === "generating",
      done:
        status === "running_tools" ||
        status === "complete",
    },
    {
      key: "runner",
      label: "Compile & validate",
      description:
        "GitHub Actions compiles the LaTeX and validates the PDF.",
      active:
        status === "running_tools",
      done:
        status === "complete",
    },
    {
      key: "published",
      label: "Published",
      description:
        "The validated candidate is pushed to its result branch.",
      active: false,
      done:
        status === "complete",
    },
  ];

  return (
    <div className="execute-layout">
      <section className="execution-card">
        <div className="execution-heading">
          <div>
            <div className="section-kicker">
              EXECUTION PIPELINE
            </div>

            <h2>
              {status === "complete"
                ? "Run completed"
                : status === "error"
                  ? "Run stopped"
                  : "Your candidate is being built"}
            </h2>

            <p>
              {state?.statusMessage ??
                "The durable workflow is waiting for its next stage."}
            </p>
          </div>

          <div
            className={`execution-state ${status}`}
          >
            <span className="status-dot live" />
            {statusLabel(status)}
          </div>
        </div>

        <div className="execution-timeline">
          {stages.map(
            (stage, index) => (
              <div
                className={`execution-stage ${stage.done ? "done" : ""} ${stage.active ? "active" : ""}`}
                key={stage.key}
              >
                <div className="stage-marker-wrap">
                  <div className="stage-marker">
                    {stage.done
                      ? "✓"
                      : index + 1}
                  </div>

                  {index !==
                    stages.length - 1 && (
                    <div className="stage-line" />
                  )}
                </div>

                <div className="stage-copy">
                  <div className="stage-title-row">
                    <strong>
                      {stage.label}
                    </strong>

                    {stage.done && (
                      <span>
                        Complete
                      </span>
                    )}

                    {stage.active && (
                      <span className="running-label">
                        Running
                      </span>
                    )}
                  </div>

                  <p>
                    {stage.description}
                  </p>
                </div>
              </div>
            ),
          )}
        </div>
      </section>

      <section className="execution-details">
        <div className="detail-card">
          <div className="section-kicker">
            TASK
          </div>

          <div className="detail-row">
            <code>
              {shortId(state?.taskId)}
            </code>

            <CopyButton
              value={state?.taskId}
            />
          </div>

          <span>
            Durable workflow identifier
          </span>
        </div>

        <div className="detail-card">
          <div className="section-kicker">
            BASE BRANCH
          </div>

          <div className="detail-row">
            <code>
              {state?.preferredBranch ||
                "repository default"}
            </code>

            {state?.preferredBranch && (
              <CopyButton
                value={
                  state.preferredBranch
                }
              />
            )}
          </div>
        </div>

        {state?.resultBranch && (
          <div className="detail-card">
            <div className="section-kicker">
              RESULT BRANCH
            </div>

            <div className="detail-row">
              <code>
                {state.resultBranch}
              </code>

              <CopyButton
                value={
                  state.resultBranch
                }
              />
            </div>
          </div>
        )}

        {state?.error && (
          <div className="execution-error">
            <div className="section-kicker">
              ERROR
            </div>

            <pre>
              {state.error}
            </pre>
          </div>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Result                                                                     */
/* -------------------------------------------------------------------------- */

function ResultView({
  state,
  setActiveView,
}: {
  state: ResumeAgentState;
  setActiveView: (view: View) => void;
}) {
  return (
    <div className="result-layout">
      <section className="result-hero">
        <div className="success-symbol">
          ✓
        </div>

        <div className="section-kicker">
          EXECUTION COMPLETE
        </div>

        <h2>
          The candidate is ready.
        </h2>

        <p>
          Your generated LaTeX and validated PDF have
          been published to the result branch.
        </p>

        <a
          href={state.resultUrl ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="github-result-button"
        >
          Open result on GitHub
          <span>↗</span>
        </a>
      </section>

      <div className="result-grid">
        <div className="result-detail">
          <span>RESULT BRANCH</span>

          <div>
            <code>
              {state.resultBranch ??
                "Unavailable"}
            </code>

            <CopyButton
              value={
                state.resultBranch
              }
            />
          </div>
        </div>

        <div className="result-detail">
          <span>TASK</span>

          <div>
            <code>
              {state.taskId ??
                "Unavailable"}
            </code>

            <CopyButton
              value={state.taskId}
            />
          </div>
        </div>

        <div className="result-detail">
          <span>PDF</span>
          <strong>
            Validated · 1 page
          </strong>
        </div>
      </div>

      <button
        type="button"
        className="new-task-button"
        onClick={() =>
          setActiveView("request")
        }
      >
        Start another request
        <span>↗</span>
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty stage                                                                */
/* -------------------------------------------------------------------------- */

function EmptyStage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="empty-stage">
      <div className="empty-stage-number">
        02
      </div>

      <h2>{title}</h2>

      <p>{description}</p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Workspace                                                                  */
/* -------------------------------------------------------------------------- */

function Workspace() {
  const [state, setState] =
    useState<ResumeAgentState | null>(null);

  const [config, setConfig] =
    useState<AppConfig | null>(null);

  const [configError, setConfigError] =
    useState("");

  const [branch, setBranch] =
    useState("");

  const [activeView, setActiveView] =
    useState<View>("request");

  const agent =
    useAgent<
      ResumeAgent,
      ResumeAgentState
    >({
      agent: "ResumeAgent",
      name: "primary",
      onStateUpdate: setState,
    });

  /*
   * Move the user to the relevant stage when the workflow
   * changes. This runs only when the status itself changes,
   * so the user can still manually navigate afterward.
   */
  const previousStatus =
    useRef<string>("idle");

  useEffect(() => {
    fetch("/api/config")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error();
        }

        return response.json() as Promise<AppConfig>;
      })
      .then((result) => {
        setConfig(result);
        setConfigError("");
      })
      .catch(() => {
        setConfigError(
          "Repository configuration unavailable.",
        );
      });
  }, []);

  useEffect(() => {
    if (
      state?.preferredBranch !==
      undefined
    ) {
      setBranch(
        state.preferredBranch,
      );
    }
  }, [state?.preferredBranch]);

  useEffect(() => {
    const status =
      state?.status ?? "idle";

    if (
      status !==
      previousStatus.current
    ) {
      const nextView =
        viewForStatus(status);

      /*
       * Only move forward automatically.
       * A user manually viewing an earlier stage
       * won't get yanked away without a state change.
       */
      setActiveView(nextView);
      previousStatus.current = status;
    }
  }, [state?.status]);

  async function saveBranch() {
    await agent.stub.setPreferredBranch(
      branch,
    );
  }

  async function logout() {
    await fetch("/api/logout", {
      method: "POST",
    });

    window.location.reload();
  }

  const pageTitle = useMemo(() => {
    if (activeView === "review") {
      return "Review";
    }

    if (activeView === "execute") {
      return "Execute";
    }

    if (activeView === "result") {
      return "Result";
    }

    return "Request";
  }, [activeView]);

  return (
    <main className="workspace-shell">
      <Sidebar
        activeView={activeView}
        setActiveView={setActiveView}
        state={state}
        config={config}
        branch={branch}
        setBranch={setBranch}
        saveBranch={saveBranch}
        logout={logout}
      />

      <section className="workspace-content">
        <WorkflowHeader
          state={state}
          activeView={activeView}
        />

        <ProgressBar
          activeView={activeView}
          state={state}
        />

        {configError && (
          <div className="global-warning">
            <span>!</span>
            {configError}
          </div>
        )}

        <div className="page-content">
          {activeView === "request" && (
            <ChatView
              agent={agent}
              state={state}
            />
          )}

          {activeView === "review" && (
            state ? (
              <ReviewView
                state={state}
                agent={agent}
              />
            ) : (
              <EmptyStage
                title="Nothing to review yet"
                description="Start a request first."
              />
            )
          )}

          {activeView === "execute" && (
            <ExecuteView
              state={state}
            />
          )}

          {activeView === "result" && (
            state?.status ===
            "complete" ? (
              <ResultView
                state={state}
                setActiveView={setActiveView}
              />
            ) : (
              <EmptyStage
                title="No result yet"
                description="The result appears here after the runner finishes successfully."
              />
            )
          )}

          {pageTitle && (
            <div className="page-footnote">
              <span>
                Persistent Agent session
              </span>

              {state?.taskId && (
                <>
                  <span>•</span>
                  <span>
                    Task{" "}
                    {shortId(
                      state.taskId,
                    )}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* App                                                                        */
/* -------------------------------------------------------------------------- */

export default function App() {
  const [
    authenticated,
    setAuthenticated,
  ] = useState<boolean | null>(
    null,
  );

  useEffect(() => {
    fetch("/api/session")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error();
        }

        return response.json() as Promise<{
          authenticated: boolean;
        }>;
      })
      .then((result) =>
        setAuthenticated(
          result.authenticated,
        ),
      )
      .catch(() =>
        setAuthenticated(false),
      );
  }, []);

  if (authenticated === null) {
    return (
      <div className="loading-page">
        <div className="loading-logo">
          R
        </div>
        <span>
          Opening workspace…
        </span>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <Login
        onLogin={() =>
          setAuthenticated(true)
        }
      />
    );
  }

  return <Workspace />;
}