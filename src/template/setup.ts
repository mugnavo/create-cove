import { readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import type { Template } from "../cli/args";
import { getTemplateConfig } from "./config";

const TITLE_MARKER = "// scaffold:title";
const DESCRIPTION_MARKER = "// scaffold:description";
const README_DESCRIPTION_MARKER = "<!-- scaffold:description -->";
const TEMPLATE_METADATA_COMMENTS = [
  "// Used by the sync-template skill to track this project's",
  "// Cove Stack source and applied template revision.",
];

type MarkerReplacement = {
  marker: string;
  replacementContent: string;
  skipEmptyLinesAfterMarker?: boolean;
};

function getReadmeDescription(template: Template, templateCommitSha?: string) {
  if (!templateCommitSha) {
    return "This project was scaffolded with [`create-cove`](https://github.com/mugnavo/create-cove).";
  }

  const templateConfig = getTemplateConfig(template);
  const shortCommitSha = templateCommitSha.slice(0, 7);
  const commitUrl = `${templateConfig.homeUrl}/tree/${templateCommitSha}`;
  const compareUrl = `${templateConfig.homeUrl}/compare/${templateCommitSha}...main`;

  return `This project was scaffolded with \`create-cove\` from commit [\`${shortCommitSha}\`](${commitUrl}). See the [template changelog](${compareUrl}) for newer changes.`;
}

function addCompareUrlToIssueWatchlist(
  lines: string[],
  template: Template,
  templateCommitSha?: string,
) {
  if (!templateCommitSha) {
    return false;
  }

  const issueWatchlistHeadingIndex = lines.findIndex(
    (line) => line.trim() === "## Issue watchlist",
  );

  if (issueWatchlistHeadingIndex === -1) {
    return false;
  }

  const nextSectionIndex = lines.findIndex(
    (line, index) => index > issueWatchlistHeadingIndex && line.startsWith("## "),
  );
  const issueWatchlistEndIndex = nextSectionIndex === -1 ? lines.length : nextSectionIndex;
  const templateConfig = getTemplateConfig(template);
  const compareUrl = `${templateConfig.homeUrl}/compare/${templateCommitSha}...main`;

  if (
    lines
      .slice(issueWatchlistHeadingIndex + 1, issueWatchlistEndIndex)
      .some((line) => line.includes(compareUrl))
  ) {
    return false;
  }

  let insertIndex = issueWatchlistHeadingIndex + 1;

  while (insertIndex < issueWatchlistEndIndex && lines[insertIndex]?.trim() === "") {
    insertIndex += 1;
  }

  lines.splice(
    insertIndex,
    0,
    `- [Template changelog](${compareUrl}) - Track template updates since this project was created.`,
  );

  return true;
}

function resolveGeneratedProjectName(dir: string, projectName: string) {
  if (projectName !== ".") {
    return projectName;
  }

  return basename(resolve(dir)) || "app";
}

async function removeLicenseFile(dir: string) {
  await rm(join(dir, "LICENSE"), { force: true });
}

function createLocalEnvFile(schema: string) {
  const lineBreak = schema.includes("\r\n") ? "\r\n" : "\n";
  const lines = schema.split(/\r?\n/);
  const headerDividerIndex = lines.findIndex((line) => /^# -{3,}$/.test(line.trim()));

  if (headerDividerIndex !== -1) {
    lines.splice(0, headerDividerIndex + 1);

    while (lines[0]?.trim() === "") {
      lines.shift();
    }
  }

  return lines.filter((line) => !line.trim().startsWith("# @")).join(lineBreak);
}

async function copyEnvFile(schemaPath: string, localEnvPath: string) {
  const schema = await readFile(schemaPath, "utf8");
  await writeFile(localEnvPath, createLocalEnvFile(schema), { flag: "wx" });
}

async function copyEnvFiles(dir: string, template: Template) {
  if (template === "default") {
    await copyEnvFile(join(dir, ".env.schema"), join(dir, ".env.local"));
    return;
  }

  if (template === "monorepo") {
    await copyEnvFile(
      join(dir, "apps", "web", ".env.schema"),
      join(dir, "apps", "web", ".env.local"),
    );
    return;
  }
}

async function updatePackageName(dir: string, projectName: string) {
  const packageJsonPath = join(dir, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    name?: string;
  };

  packageJson.name = resolveGeneratedProjectName(dir, projectName);
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

function parseTemplateMetadata(contents: string) {
  const json = contents
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => !TEMPLATE_METADATA_COMMENTS.some((comment) => line.trim() === comment))
    .join("\n");
  const metadata = JSON.parse(json) as unknown;

  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new TypeError("Template metadata must be a JSON object");
  }

  return metadata as Record<string, unknown>;
}

function serializeTemplateMetadata(metadata: Record<string, unknown>) {
  const lines = JSON.stringify(metadata, null, 2).split("\n");
  const sourceIndex = lines.findIndex((line) => line.startsWith('  "source":'));

  if (sourceIndex === -1) {
    throw new TypeError("Template metadata must contain a source");
  }

  lines.splice(sourceIndex, 0, ...TEMPLATE_METADATA_COMMENTS.map((comment) => `  ${comment}`));
  return `${lines.join("\n")}\n`;
}

async function readTemplateMetadata(filePath: string) {
  try {
    return parseTemplateMetadata(await readFile(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function updateTemplateMetadata(dir: string, template: Template, templateCommitSha?: string) {
  if (!templateCommitSha) {
    return;
  }

  const metadataPath = join(dir, ".cove.jsonc");
  const metadata = await readTemplateMetadata(metadataPath);

  Object.assign(metadata, {
    source: getTemplateConfig(template).homeUrl,
    revision: templateCommitSha,
    createdAt: new Date().toISOString(),
  });

  await writeFile(metadataPath, serializeTemplateMetadata(metadata));
}

async function updateReadme(
  dir: string,
  template: Template,
  projectName: string,
  templateCommitSha?: string,
) {
  const readmePath = join(dir, "README.md");
  const generatedProjectName = resolveGeneratedProjectName(dir, projectName);
  const readme = await readFile(readmePath, "utf8");
  const lineBreak = readme.includes("\r\n") ? "\r\n" : "\n";
  const lines = readme.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.startsWith("# "));

  if (headingIndex === -1) {
    if (lines.length > 0) {
      lines[0] = `# ${generatedProjectName}`;
    }
  } else {
    lines[headingIndex] = `# ${generatedProjectName}`;
  }

  replaceMarkersInLines(lines, [
    {
      marker: README_DESCRIPTION_MARKER,
      replacementContent: getReadmeDescription(template, templateCommitSha),
      skipEmptyLinesAfterMarker: true,
    },
  ]);

  addCompareUrlToIssueWatchlist(lines, template, templateCommitSha);

  const updatedReadme = lines.join(lineBreak);

  if (updatedReadme !== readme) {
    await writeFile(readmePath, updatedReadme);
  }
}

function replaceMarkersInLines(lines: string[], replacements: MarkerReplacement[]) {
  let didChange = false;

  for (const { marker, replacementContent, skipEmptyLinesAfterMarker } of replacements) {
    const markerIndex = lines.findIndex((line) => line.trim() === marker);

    if (markerIndex === -1) {
      continue;
    }

    let targetIndex = markerIndex + 1;

    if (skipEmptyLinesAfterMarker) {
      while (lines[targetIndex] !== undefined && lines[targetIndex]?.trim() === "") {
        targetIndex += 1;
      }
    }

    const targetLine = lines[targetIndex];

    if (targetLine === undefined) {
      lines.splice(markerIndex, 1);
      didChange = true;
      continue;
    }

    const indentation = targetLine.match(/^\s*/)?.[0] ?? "";
    const updatedLine = `${indentation}${replacementContent}`;

    lines.splice(markerIndex, targetIndex - markerIndex + 1, updatedLine);
    didChange = true;
  }

  return didChange;
}

async function replaceLinesAfterMarkers(filePath: string, replacements: MarkerReplacement[]) {
  const fileContents = await readFile(filePath, "utf8");
  const lineBreak = fileContents.includes("\r\n") ? "\r\n" : "\n";
  const lines = fileContents.split(/\r?\n/);

  if (!replaceMarkersInLines(lines, replacements)) {
    return;
  }

  await writeFile(filePath, lines.join(lineBreak));
}

async function updateAppMetadata(dir: string, template: Template, projectName: string) {
  const generatedProjectName = resolveGeneratedProjectName(dir, projectName);
  const rootRoutePath =
    template === "default"
      ? join(dir, "src", "routes", "__root.tsx")
      : join(dir, "apps", "web", "src", "routes", "__root.tsx");

  await replaceLinesAfterMarkers(rootRoutePath, [
    {
      marker: TITLE_MARKER,
      replacementContent: `title: ${JSON.stringify(generatedProjectName)},`,
    },
    {
      marker: DESCRIPTION_MARKER,
      replacementContent: `content: "A TanStack Start project scaffolded with create-cove.",`,
    },
  ]);
}

export async function prepareTemplateFiles(
  dir: string,
  template: Template,
  projectName: string,
  templateCommitSha?: string,
) {
  await Promise.allSettled([
    removeLicenseFile(dir),
    copyEnvFiles(dir, template),
    updatePackageName(dir, projectName),
    updateTemplateMetadata(dir, template, templateCommitSha),
    updateReadme(dir, template, projectName, templateCommitSha),
    updateAppMetadata(dir, template, projectName),
  ]);
}
