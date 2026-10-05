function decodeEntities(text: string) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function extractFirstUrl(input: string): string | null {
  const match = input.match(/https?:\/\/[^\s<>()]+/i);
  if (!match) return null;
  try {
    return new URL(match[0]).toString();
  } catch {
    return null;
  }
}

function htmlToText(html: string) {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  ).slice(0, 18000);
}

export async function resolveJobText(env: Env, request: string) {
  const url = extractFirstUrl(request);

  if (!url) {
    return {
      source: "text" as const,
      url: null,
      text: request.trim().slice(0, 18000),
    };
  }

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Resume-Agent/1.0",
        accept: "text/html,text/plain;q=0.9,*/*;q=0.5",
      },
      redirect: "follow",
    });

    if (response.ok) {
      const contentType = response.headers.get("content-type") ?? "";
      const body = await response.text();
      const text = contentType.includes("text/html")
        ? htmlToText(body)
        : body.trim().slice(0, 18000);

      if (text.length >= 300) {
        return { source: "url" as const, url, text };
      }
    }
  } catch {
    // Fall back to Browser Run.
  }

  const browserResponse = await env.BROWSER.quickAction("markdown", { url });
  const markdown = (await browserResponse.text()).trim().slice(0, 18000);

  if (markdown.length < 100) {
    throw new Error(`Could not extract useful job description text from ${url}.`);
  }

  return { source: "url" as const, url, text: markdown };
}
