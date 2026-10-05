function apiUrl(env: Env, path: string) {
  return `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}${path}`;
}

function encodeBase64Utf8(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function decodeBase64Utf8(value: string) {
  const binary = atob(value.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function githubFetch(env: Env, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${env.GITHUB_TOKEN}`);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  headers.set("User-Agent", "resume-agent");

  const response = await fetch(apiUrl(env, path), {
    ...init,
    headers,
  });

  const bodyText = await response.text();
  let body: unknown = null;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = bodyText;
  }

  if (!response.ok) {
    throw new Error(
      `GitHub ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`,
    );
  }

  return body;
}

export async function getRepository(env: Env) {
  return (await githubFetch(env, "")) as {
    html_url: string;
    default_branch: string;
  };
}

export async function getBranchHeadSha(env: Env, branch: string) {
  const result = (await githubFetch(
    env,
    `/git/ref/heads/${encodeURIComponent(branch)}`,
  )) as { object: { sha: string } };
  return result.object.sha;
}

export async function getFile(env: Env, branch: string, path: string) {
  const result = (await githubFetch(
    env,
    `/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`,
  )) as {
    type: string;
    encoding: string;
    content: string;
    sha: string;
  };

  if (result.type !== "file") {
    throw new Error(`${path} is not a file.`);
  }

  return {
    text: decodeBase64Utf8(result.content),
    sha: result.sha,
  };
}

export async function ensureBranch(env: Env, branch: string, baseSha: string) {
  try {
    return await getBranchHeadSha(env, branch);
  } catch {
    await githubFetch(env, "/git/refs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: baseSha,
      }),
    });
    return baseSha;
  }
}

export async function updateFile(
  env: Env,
  branch: string,
  path: string,
  content: string,
  sha: string,
  message: string,
) {
  return githubFetch(
    env,
    `/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        content: encodeBase64Utf8(content),
        sha,
        branch,
      }),
    },
  );
}

export async function dispatchRunner(
  env: Env,
  branch: string,
  taskId: string,
  attempt: number,
  retry: number,
) {
  await githubFetch(
    env,
    `/actions/workflows/${encodeURIComponent(env.RUNNER_WORKFLOW)}/dispatches`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: branch,
        inputs: {
          task_id: taskId,
          attempt: String(attempt),
          retry: String(retry),
        },
      }),
    },
  );
}

export async function deleteBranch(env: Env, branch: string) {
  try {
    await githubFetch(
      env,
      `/git/refs/heads/${encodeURIComponent(branch)}`,
      { method: "DELETE" },
    );
  } catch (error) {
    if (String(error).includes("GitHub 404")) return;
    throw error;
  }
}

export function branchUrl(env: Env, branch: string) {
  return `https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/tree/${encodeURIComponent(branch)}`;
}
