import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CliArgs } from "../src/cli/args";
import { ensureDirectoryIsEmpty, resolveCliOptions, validateProjectName } from "../src/cli/prompts";
import { getTemplateConfig } from "../src/template/config";
import { prepareTemplateFiles } from "../src/template/setup";
import {
  resolveTemplateCommitSha,
  resolveTemplateDownloadSource,
} from "../src/template/source-metadata";

const tempDirs: string[] = [];
const originalCwd = process.cwd();
const templateMetadataComments = [
  "// Used by the sync-template skill to track this project's",
  "// Cove Stack source and applied template revision.",
];

function formatTemplateMetadata(metadata: Record<string, unknown>) {
  const lines = JSON.stringify(metadata, null, 2).split("\n");
  const sourceIndex = lines.findIndex((line) => line.startsWith('  "source":'));

  lines.splice(sourceIndex, 0, ...templateMetadataComments.map((comment) => `  ${comment}`));
  return `${lines.join("\n")}\n`;
}

async function createTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "create-cove-"));
  tempDirs.push(dir);
  return dir;
}

function createCliArgs(overrides: {
  name?: CliArgs["name"];
  template?: CliArgs["template"];
  install?: CliArgs["install"];
  packageManager?: CliArgs["packageManager"];
}): CliArgs {
  return {
    _: [],
    ...overrides,
  } as unknown as CliArgs;
}

const envSchema = [
  "# This env file uses @env-spec: https://varlock.dev/env-spec",
  "#",
  "# @defaultRequired=false @defaultSensitive=false",
  "# @generateTsTypes(path=env.d.ts)",
  "# ----------",
  "",
  "# Public origin used by the browser.",
  "# @public @type=url",
  "PUBLIC_APP_URL=http://localhost:3000",
  "",
  "# @sensitive",
  "DATABASE_URL=",
  "",
].join("\n");

beforeEach(() => {
  process.chdir(originalCwd);
});

describe("prepareTemplateFiles", () => {
  afterEach(async () => {
    vi.useRealTimers();
    process.chdir(originalCwd);
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("removes the readme marker and blank line before the description", async () => {
    const dir = await createTempDir();

    await mkdir(join(dir, "src", "routes"), { recursive: true });
    await writeFile(join(dir, ".env.schema"), envSchema);
    await writeFile(join(dir, "package.json"), '{"name":"template-app"}\n');
    await writeFile(
      join(dir, "README.md"),
      ["# template-app", "", "<!-- scaffold:description -->", "", "Template description.", ""].join(
        "\n",
      ),
    );
    await writeFile(
      join(dir, "src", "routes", "__root.tsx"),
      [
        "export const Route = {",
        "  head: () => ({",
        "    // scaffold:title",
        '    title: "template-app",',
        "    meta: [",
        "      {",
        "        // scaffold:description",
        '        content: "Template description.",',
        "      },",
        "    ],",
        "  }),",
        "};",
        "",
      ].join("\n"),
    );

    await prepareTemplateFiles(dir, "default", "my-app");

    await expect(readFile(join(dir, ".env.local"), "utf8")).resolves.toBe(
      [
        "# Public origin used by the browser.",
        "PUBLIC_APP_URL=http://localhost:3000",
        "",
        "DATABASE_URL=",
        "",
      ].join("\n"),
    );

    await expect(readFile(join(dir, "README.md"), "utf8")).resolves.toBe(
      [
        "# my-app",
        "",
        "This project was scaffolded from [Cove Stack](https://github.com/mugnavo/cove) with [`create-cove`](https://github.com/mugnavo/create-cove).",
        "",
      ].join("\n"),
    );
  });

  it("uses the current directory name when projectName is .", async () => {
    const dir = await createTempDir();
    const directoryName = basename(dir);

    await mkdir(join(dir, "src", "routes"), { recursive: true });
    await writeFile(join(dir, ".env.schema"), envSchema);
    await writeFile(join(dir, "package.json"), '{"name":"template-app"}\n');
    await writeFile(
      join(dir, "README.md"),
      ["# template-app", "", "<!-- scaffold:description -->", "", "Template description.", ""].join(
        "\n",
      ),
    );
    await writeFile(
      join(dir, "src", "routes", "__root.tsx"),
      [
        "export const Route = {",
        "  head: () => ({",
        "    // scaffold:title",
        '    title: "template-app",',
        "    meta: [",
        "      {",
        "        // scaffold:description",
        '        content: "Template description.",',
        "      },",
        "    ],",
        "  }),",
        "};",
        "",
      ].join("\n"),
    );

    await prepareTemplateFiles(dir, "default", ".");

    await expect(readFile(join(dir, "package.json"), "utf8")).resolves.toBe(
      `${JSON.stringify({ name: directoryName }, null, 2)}\n`,
    );
    await expect(readFile(join(dir, "README.md"), "utf8")).resolves.toBe(
      [
        `# ${directoryName}`,
        "",
        "This project was scaffolded from [Cove Stack](https://github.com/mugnavo/cove) with [`create-cove`](https://github.com/mugnavo/create-cove).",
        "",
      ].join("\n"),
    );
    await expect(readFile(join(dir, "src", "routes", "__root.tsx"), "utf8")).resolves.toContain(
      `title: ${JSON.stringify(directoryName)},`,
    );
  });

  it("records the exact template revision when it is available", async () => {
    const dir = await createTempDir();
    const revision = "3ee0799e99d9f9fea67f430850bc7b15de32f556";
    const createdAt = "2026-09-18T04:30:00.000Z";

    vi.useFakeTimers();
    vi.setSystemTime(new Date(createdAt));

    await mkdir(join(dir, "src", "routes"), { recursive: true });
    await writeFile(join(dir, ".env.schema"), envSchema);
    await writeFile(
      join(dir, "package.json"),
      '{"name":"template-app","generator":"create-cove"}\n',
    );
    await writeFile(join(dir, "README.md"), "# template-app\n");
    await writeFile(
      join(dir, "src", "routes", "__root.tsx"),
      '// scaffold:title\ntitle: "template-app",\n',
    );

    await prepareTemplateFiles(dir, "default", "my-app", revision);

    await expect(readFile(join(dir, "package.json"), "utf8")).resolves.toBe(
      `${JSON.stringify(
        {
          name: "my-app",
          generator: "create-cove",
        },
        null,
        2,
      )}\n`,
    );
    await expect(readFile(join(dir, ".cove.jsonc"), "utf8")).resolves.toBe(
      formatTemplateMetadata({
        source: "https://github.com/mugnavo/cove",
        revision,
        createdAt,
      }),
    );
  });

  it("keeps existing Cove metadata unchanged when the revision is unavailable", async () => {
    const dir = await createTempDir();
    const metadata = formatTemplateMetadata({
      source: "https://github.com/mugnavo/cove",
      customField: "preserved",
    });

    await mkdir(join(dir, "src", "routes"), { recursive: true });
    await writeFile(join(dir, ".env.schema"), envSchema);
    await writeFile(join(dir, ".cove.jsonc"), metadata);
    await writeFile(join(dir, "package.json"), '{"name":"template-app"}\n');
    await writeFile(join(dir, "README.md"), "# template-app\n");
    await writeFile(
      join(dir, "src", "routes", "__root.tsx"),
      '// scaffold:title\ntitle: "template-app",\n',
    );

    await prepareTemplateFiles(dir, "default", "my-app");

    await expect(readFile(join(dir, ".cove.jsonc"), "utf8")).resolves.toBe(metadata);
  });

  it("keeps invalid template metadata unchanged", async () => {
    const dir = await createTempDir();
    const metadata = `{\n${templateMetadataComments.map((comment) => `  ${comment}`).join("\n")}\n  "source":`;

    await mkdir(join(dir, "src", "routes"), { recursive: true });
    await writeFile(join(dir, ".env.schema"), envSchema);
    await writeFile(join(dir, ".cove.jsonc"), metadata);
    await writeFile(join(dir, "package.json"), '{"name":"template-app"}\n');
    await writeFile(join(dir, "README.md"), "# template-app\n");
    await writeFile(
      join(dir, "src", "routes", "__root.tsx"),
      '// scaffold:title\ntitle: "template-app",\n',
    );

    await prepareTemplateFiles(
      dir,
      "default",
      "my-app",
      "3ee0799e99d9f9fea67f430850bc7b15de32f556",
    );

    await expect(readFile(join(dir, ".cove.jsonc"), "utf8")).resolves.toBe(metadata);
  });

  it("creates a cleaned local env file for the monorepo web app", async () => {
    const dir = await createTempDir();
    const revision = "a60f578165b40710e2755ed757916b6ee605a919";
    const createdAt = "2026-09-18T04:30:00.000Z";

    vi.useFakeTimers();
    vi.setSystemTime(new Date(createdAt));

    await mkdir(join(dir, "apps", "web", "src", "routes"), { recursive: true });
    await writeFile(join(dir, "apps", "web", ".env.schema"), envSchema);
    await writeFile(join(dir, "package.json"), '{"name":"template-app"}\n');
    await writeFile(
      join(dir, ".cove.jsonc"),
      formatTemplateMetadata({
        source: "https://github.com/mugnavo/cove-monorepo",
        customField: "preserved",
      }),
    );
    await writeFile(join(dir, "README.md"), "# template-app\n");
    await writeFile(
      join(dir, "apps", "web", "src", "routes", "__root.tsx"),
      [
        "// scaffold:title",
        'title: "template-app",',
        "// scaffold:description",
        "description",
        "",
      ].join("\n"),
    );

    await prepareTemplateFiles(dir, "monorepo", "my-app", revision);

    await expect(readFile(join(dir, "apps", "web", ".env.local"), "utf8")).resolves.toBe(
      [
        "# Public origin used by the browser.",
        "PUBLIC_APP_URL=http://localhost:3000",
        "",
        "DATABASE_URL=",
        "",
      ].join("\n"),
    );
    await expect(readFile(join(dir, "package.json"), "utf8")).resolves.toBe(
      `${JSON.stringify({ name: "my-app" }, null, 2)}\n`,
    );
    await expect(readFile(join(dir, ".cove.jsonc"), "utf8")).resolves.toBe(
      formatTemplateMetadata({
        source: "https://github.com/mugnavo/cove-monorepo",
        customField: "preserved",
        revision,
        createdAt,
      }),
    );
  });
});

describe("template source metadata", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pins the download source when a revision is available", () => {
    const templateConfig = getTemplateConfig("default");
    const revision = "3ee0799e99d9f9fea67f430850bc7b15de32f556";

    expect(resolveTemplateDownloadSource(templateConfig, revision)).toBe(
      `github:mugnavo/cove#${revision}`,
    );
    expect(resolveTemplateDownloadSource(templateConfig)).toBe("github:mugnavo/cove");
  });

  it("resolves the template's main branch commit", async () => {
    const revision = "3ee0799e99d9f9fea67f430850bc7b15de32f556";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ sha: revision })));

    await expect(resolveTemplateCommitSha(getTemplateConfig("default"))).resolves.toBe(revision);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/mugnavo/cove/commits/main",
      expect.objectContaining({
        headers: expect.objectContaining({ "user-agent": "create-cove" }),
      }),
    );
  });

  it("omits the revision when GitHub metadata is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    await expect(resolveTemplateCommitSha(getTemplateConfig("default"))).resolves.toBeUndefined();
  });
});

describe("validateProjectName", () => {
  it("allows . to scaffold into the current directory", () => {
    expect(validateProjectName(".")).toBeUndefined();
  });

  it("trims leading and trailing whitespace", () => {
    expect(validateProjectName("  my-app  ")).toBeUndefined();
  });

  it("accepts a safe cross-platform package name", () => {
    expect(validateProjectName("my-app_2")).toBeUndefined();
    expect(validateProjectName("MyApp")).toBeUndefined();
  });

  it("rejects names with path separators", () => {
    expect(validateProjectName("@scope/app")).toBe("Project name cannot contain path separators");
    expect(validateProjectName("my\\app")).toBe("Project name cannot contain path separators");
  });

  it("still rejects ..", () => {
    expect(validateProjectName("..")).toBe("Project name cannot be ..");
  });

  it("rejects names that are invalid on Windows", () => {
    expect(validateProjectName("my:app")).toBe("Project name contains invalid characters");
  });

  it("rejects names outside the supported character set", () => {
    expect(validateProjectName("my app")).toBe(
      "Use letters, numbers, periods, underscores, or hyphens",
    );
  });
});

describe("ensureCurrentDirectoryIsEmpty", () => {
  it("returns undefined for an empty current directory", async () => {
    const dir = await createTempDir();

    process.chdir(dir);

    await expect(ensureDirectoryIsEmpty(process.cwd())).resolves.toBeUndefined();
  });

  it("returns an error for a non-empty current directory", async () => {
    const dir = await createTempDir();

    await writeFile(join(dir, "README.md"), "existing\n");
    process.chdir(dir);

    await expect(ensureDirectoryIsEmpty(process.cwd())).resolves.toBe("Directory must be empty.");
  });

  it("returns undefined for a missing target directory", async () => {
    const dir = await createTempDir();

    await expect(ensureDirectoryIsEmpty(join(dir, "new-project"))).resolves.toBeUndefined();
  });

  it("returns undefined for an existing empty target directory", async () => {
    const dir = await createTempDir();
    const targetDir = join(dir, "empty-project");

    await mkdir(targetDir);

    await expect(ensureDirectoryIsEmpty(targetDir)).resolves.toBeUndefined();
  });

  it("returns an error for an existing non-empty target directory", async () => {
    const dir = await createTempDir();
    const targetDir = join(dir, "existing-project");

    await mkdir(targetDir);
    await writeFile(join(targetDir, "README.md"), "existing\n");

    await expect(ensureDirectoryIsEmpty(targetDir)).resolves.toBe("Directory must be empty.");
  });
});

describe("resolveCliOptions", () => {
  it("allows a named target directory when it does not exist yet", async () => {
    const dir = await createTempDir();

    process.chdir(dir);

    await expect(
      resolveCliOptions(
        createCliArgs({
          name: "new-project",
          template: "default",
          install: false,
        }),
      ),
    ).resolves.toMatchObject({
      projectName: "new-project",
      template: "default",
      install: false,
    });
  });

  it("allows a named target directory when it exists and is empty", async () => {
    const dir = await createTempDir();

    await mkdir(join(dir, "existing-project"));
    process.chdir(dir);

    await expect(
      resolveCliOptions(
        createCliArgs({
          name: "existing-project",
          template: "default",
          install: false,
        }),
      ),
    ).resolves.toMatchObject({
      projectName: "existing-project",
      template: "default",
      install: false,
    });
  });

  it("rejects a named target directory when it exists and is not empty", async () => {
    const dir = await createTempDir();
    const targetDir = join(dir, "existing-project");

    await mkdir(targetDir);
    await writeFile(join(targetDir, "README.md"), "existing\n");
    process.chdir(dir);

    await expect(
      resolveCliOptions(
        createCliArgs({
          name: "existing-project",
          template: "default",
          install: false,
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
