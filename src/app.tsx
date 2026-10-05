import { useEffect, useState, type FormEvent } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { ResumeAgent } from "./server";
import type { ResumeAgentState } from "./types";

type AppConfig = {
  repository: string;
  resumeFile: string;
};

function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });

    setLoading(false);

    if (!response.ok) {
      setError("Invalid password.");
      return;
    }

    onLogin();
  }

  return (
    <main className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <div className="eyebrow">RESUME AGENT</div>
        <h1>Your resume gets an execution layer.</h1>
        <p>
          A single-user workspace that analyzes a role, prepares a LaTeX
          revision, validates the PDF, and publishes the approved result to GitHub.
        </p>
        <input
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          placeholder="Workspace password"
          autoFocus
        />
        <button disabled={loading}>{loading ? "Checking..." : "Enter workspace"}</button>
        {error && <div className="error-banner">{error}</div>}
      </form>
    </main>
  );
}

function Chat({ agent }: { agent: any }) {
  const chat = useAgentChat({ agent });
  const [draft, setDraft] = useState("");

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || chat.status === "streaming") return;
    setDraft("");
    await chat.sendMessage({ text });
  }

  return (
    <section className="panel chat-panel">
      <div className="eyebrow">COMMAND</div>
      <h2>Tell the agent what to do</h2>

      <div className="messages">
        {chat.messages.length === 0 && (
          <div className="empty-state">
            <strong>Try:</strong> Tailor my resume for this job: paste a job URL or paste the full JD. Use my quant branch and keep education unchanged.
          </div>
        )}

        {chat.messages.map((message) => (
          <div className={`message ${message.role}`} key={message.id}>
            <div className="message-role">
              {message.role === "user" ? "YOU" : "AGENT"}
            </div>
            <div className="message-body">
              {message.parts?.map((part: any, index: number) =>
                part.type === "text" ? (
                  <p key={`${message.id}-${index}`}>{part.text}</p>
                ) : null,
              )}
            </div>
          </div>
        ))}
      </div>

      <form className="composer" onSubmit={send}>
        <textarea
          rows={5}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Tailor my resume for..."
        />
        <div className="composer-footer">
          <span>Job pages are treated as untrusted data.</span>
          <button disabled={chat.status === "streaming"}>Send</button>
        </div>
      </form>
    </section>
  );
}

function Workspace() {
  const [authenticated] = useState(true);
  const [state, setState] = useState<ResumeAgentState | null>(null);
  const [branch, setBranch] = useState("");
  const [approvalNote, setApprovalNote] = useState("");
  const [config, setConfig] = useState<AppConfig | null>(null);

  const agent = useAgent<ResumeAgent, ResumeAgentState>({
    agent: "ResumeAgent",
    name: "primary",
    onStateUpdate: setState,
  });

  useEffect(() => {
    fetch("/api/config")
      .then((response) => response.json() as Promise<AppConfig>)
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    if (state?.preferredBranch !== undefined) {
      setBranch(state.preferredBranch);
    }
  }, [state?.preferredBranch]);

  async function saveBranch() {
    await agent.stub.setPreferredBranch(branch);
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.reload();
  }

  const busy = [
    "analyzing",
    "awaiting_approval",
    "generating",
    "running_tools",
  ].includes(state?.status ?? "");

  if (!authenticated) return null;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">RESUME AGENT</div>
          <div className="brand">Execution workspace</div>
        </div>
        <button className="secondary" onClick={logout}>Lock</button>
      </header>

      <div className="workspace-grid">
        <div className="left-column">
          <section className="panel settings-panel">
            <div className="eyebrow">PRIVATE SOURCE</div>
            <h2>GitHub resume repository</h2>
            <div className="repo-pill">{config?.repository ?? "Loading..."}</div>
            <div className="field-row">
              <div>
                <label>Resume file</label>
                <div className="readonly">{config?.resumeFile ?? "resume.tex"}</div>
              </div>
              <div>
                <label>Default behavior</label>
                <div className="readonly">Repository default branch</div>
              </div>
            </div>
            <label>Preferred base branch</label>
            <div className="inline-form">
              <input
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder="Leave blank for default branch"
              />
              <button className="secondary" onClick={saveBranch}>Save</button>
            </div>
            <p className="hint">This is persistent Agent state for the single-user MVP.</p>
          </section>

          <Chat agent={agent} />
        </div>

        <aside className="right-column">
          <section className="panel status-panel">
            <div className="panel-row">
              <div>
                <div className="eyebrow">WORKFLOW</div>
                <h2>Current state</h2>
              </div>
              <span className={`status-dot ${state?.status ?? "idle"}`} />
            </div>
            <div className="status-name">{(state?.status ?? "idle").replaceAll("_", " ")}</div>
            <p>{state?.statusMessage ?? "Connecting to your Agent..."}</p>
            {busy && <div className="progress-track"><div className="progress-bar" /></div>}
            {state?.taskId && <div className="mono">task {state.taskId.slice(0, 8)}</div>}
            {state?.error && <pre className="error-box">{state.error}</pre>}
          </section>

          {state?.analysis && (
            <section className="panel analysis-panel">
              <div className="eyebrow">ROLE ANALYSIS</div>
              <h2>{state.analysis.roleTitle}</h2>
              <p>{state.analysis.summary}</p>

              <h3>Strong matches</h3>
              <div className="chips">
                {state.analysis.strongMatches.map((item) => <span key={item}>{item}</span>)}
              </div>

              <h3>Improvement areas</h3>
              <div className="chips muted-chips">
                {state.analysis.improvementAreas.map((item) => <span key={item}>{item}</span>)}
              </div>

              <h3>Suggested changes</h3>
              <div className="suggestions">
                {state.analysis.suggestions.map((item, index) => (
                  <div className="suggestion" key={`${item.section}-${index}`}>
                    <strong>{item.section}</strong>
                    <div className="diff old">{item.current}</div>
                    <div className="diff new">{item.proposed}</div>
                    <p>{item.reason}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {state?.status === "awaiting_approval" && (
            <section className="panel approval-panel">
              <div className="eyebrow">HUMAN APPROVAL</div>
              <h2>Generate the candidate?</h2>
              <p>No result branch has been created yet.</p>
              <textarea
                value={approvalNote}
                onChange={(event) => setApprovalNote(event.target.value)}
                rows={3}
                placeholder="Optional instructions for the generation pass..."
              />
              <div className="button-row">
                <button className="secondary" onClick={() => agent.stub.rejectTask()}>Reject</button>
                <button onClick={() => agent.stub.approveTask(approvalNote)}>Approve & generate</button>
              </div>
            </section>
          )}

          {state?.status === "complete" && state.resultUrl && (
            <section className="panel success-panel">
              <div className="eyebrow">PUBLISHED</div>
              <h2>Ready for verification</h2>
              <p>The generated LaTeX and PDF are on the result branch.</p>
              <a href={state.resultUrl} target="_blank" rel="noreferrer">
                Open branch on GitHub ↗
              </a>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/session")
      .then((response) => response.json() as Promise<{ authenticated: boolean }>)
      .then((result) => setAuthenticated(result.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  if (authenticated === null) return <div className="loading">Loading...</div>;
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;
  return <Workspace />;
}
