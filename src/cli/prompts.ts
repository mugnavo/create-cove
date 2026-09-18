import { readdir } from "node:fs/promises";
import { join } from "node:path";

import * as p from "@clack/prompts";

import {
  PACKAGE_MANAGER_VALUES,
  TEMPLATE_VALUES,
  type CliArgs,
  type PackageManager,
  type Template,
} from "./args";
import { detectPackageManagerFromUserAgent, isPnpmAvailable } from "./package-manager";

export interface ResolvedCliOptions {
  projectName: string;
  template: Template;
  install: boolean;
  selectedPackageManager?: PackageManager;
  preferredPackageManager: PackageManager;
}

const PROJECT_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

function containsWindowsInvalidCharacters(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (codePoint === undefined) {
      continue;
    }

    if (codePoint <= 31 || '<>:"|?*'.includes(character)) {
      return true;
    }
  }

  return false;
}

export function validateProjectName(value: string) {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    return "Project name is required";
  }

  if (normalizedValue === ".") {
    return undefined;
  }

  if (normalizedValue.includes("/") || normalizedValue.includes("\\")) {
    return "Project name cannot contain path separators";
  }

  if (containsWindowsInvalidCharacters(normalizedValue)) {
    return "Project name contains invalid characters";
  }

  if (normalizedValue === "..") {
    return "Project name cannot be ..";
  }

  if (normalizedValue.startsWith(".")) {
    return "Project name cannot start with a period";
  }

  if (normalizedValue.endsWith(".") || normalizedValue.endsWith("-")) {
    return "Project name cannot end with a period or hyphen";
  }

  if (normalizedValue.length > 214) {
    return "Project name must be 214 characters or fewer";
  }

  if (!PROJECT_NAME_PATTERN.test(normalizedValue)) {
    return "Use letters, numbers, periods, underscores, or hyphens";
  }

  return undefined;
}

function isOneOf<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

export async function ensureDirectoryIsEmpty(dir: string) {
  let entries: string[];

  try {
    entries = await readdir(dir);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }

  if (entries.length > 0) {
    return "Directory must be empty.";
  }

  return undefined;
}

async function promptProjectName() {
  const projectName = await p.text({
    message: "Project name:",
    placeholder: "my-project",
    defaultValue: "my-project",
    validate(value) {
      if (typeof value !== "string") {
        return;
      }
      return validateProjectName(value);
    },
  });

  if (p.isCancel(projectName)) {
    p.cancel("Operation cancelled.");
    return;
  }

  return projectName;
}

async function promptTemplate() {
  const template = await p.select({
    message: "Select a template:",
    options: [
      { value: "default", label: "Default", hint: "minimal Cove Stack template" },
      {
        value: "monorepo",
        label: "Monorepo",
        hint: "Cove Stack via pnpm workspaces",
      },
    ],
  });

  if (p.isCancel(template)) {
    p.cancel("Operation cancelled.");
    return;
  }

  return template;
}

async function promptInstall() {
  const install = await p.confirm({
    message: "Install dependencies after scaffolding?",
    initialValue: true,
  });

  if (p.isCancel(install)) {
    p.cancel("Operation cancelled.");
    return;
  }

  return install;
}
/**
 * For now, we only support pnpm for installations.
 * Maybe we can remove some of this code later if we don't end up supporting other package managers.
 */
// async function promptPackageManager(
//   preferredPackageManager: ResolvedCliOptions["preferredPackageManager"],
// ) {
//   const selectedPackageManager = await p.select({
//     message: "Select a package manager:",
//     options: [
//       { value: "pnpm", label: "pnpm (Recommended)" },
//       { value: "npm", label: "npm" },
//       { value: "bun", label: "bun" },
//       { value: "yarn", label: "yarn" },
//       { value: "deno", label: "deno" },
//     ],
//     initialValue: preferredPackageManager,
//   });

//   if (p.isCancel(selectedPackageManager)) {
//     p.cancel("Operation cancelled.");
//     return;
//   }

//   return selectedPackageManager;
// }

export async function resolveCliOptions(args: CliArgs): Promise<ResolvedCliOptions | undefined> {
  let projectName = args.name;
  let template = args.template;
  let install = args.install;
  // let selectedPackageManager = args.packageManager;
  let selectedPackageManager: PackageManager | undefined = undefined;

  const preferredPackageManager = (await isPnpmAvailable())
    ? "pnpm"
    : detectPackageManagerFromUserAgent();

  if (!projectName) {
    projectName = await promptProjectName();
    if (!projectName) return;
  }

  projectName = String(projectName).trim();

  const targetDirectory = projectName === "." ? process.cwd() : join(process.cwd(), projectName);
  const targetDirectoryError = await ensureDirectoryIsEmpty(targetDirectory);

  if (targetDirectoryError) {
    p.cancel(targetDirectoryError);
    return;
  }

  const projectNameError = validateProjectName(projectName);
  if (projectNameError) {
    p.cancel(projectNameError);
    return;
  }

  if (!template) {
    template = await promptTemplate();
    if (!template) return;
  }

  // if (install === undefined) {
  //   install = await promptInstall();
  //   if (install === undefined) return;
  // }

  // if (install && !selectedPackageManager) {
  //   selectedPackageManager = await promptPackageManager(preferredPackageManager);
  //   if (!selectedPackageManager) return;
  // }

  if (install === undefined && preferredPackageManager === "pnpm") {
    install = await promptInstall();
    if (install === undefined) return;
  }

  if (!isOneOf(TEMPLATE_VALUES, template) || typeof install !== "boolean") return;
  if (
    selectedPackageManager !== undefined &&
    !isOneOf(PACKAGE_MANAGER_VALUES, selectedPackageManager)
  )
    return;

  return {
    projectName,
    template,
    install,
    selectedPackageManager,
    preferredPackageManager,
  };
}
