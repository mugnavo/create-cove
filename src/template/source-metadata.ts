import type { TemplateConfig } from "./config";

function resolveRepositoryName(homeUrl: string) {
  return new URL(homeUrl).pathname.replace(/^\/|\/$/g, "");
}

export function resolveTemplateDownloadSource(
  templateConfig: TemplateConfig,
  templateCommitSha?: string,
) {
  return templateCommitSha
    ? `${templateConfig.source}#${templateCommitSha}`
    : templateConfig.source;
}

export async function resolveTemplateCommitSha(
  templateConfig: TemplateConfig,
): Promise<string | undefined> {
  try {
    const repository = resolveRepositoryName(templateConfig.homeUrl);
    const response = await fetch(`https://api.github.com/repos/${repository}/commits/main`, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "create-cove",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`GitHub API request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      sha?: string;
    };

    if (!payload.sha) {
      throw new Error("GitHub API response did not include commit metadata");
    }

    return payload.sha;
  } catch {
    return undefined;
  }
}
