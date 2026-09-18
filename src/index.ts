import * as p from "@clack/prompts";
import { defineCommand, runMain } from "citty";
import { downloadTemplate } from "giget";

import packageJson from "../package.json" with { type: "json" };
import { cliArgs } from "./cli/args";
import { getDevCommand, initGitRepo, installDependencies } from "./cli/package-manager";
import { resolveCliOptions } from "./cli/prompts";
import { getTemplateConfig } from "./template/config";
import { prepareTemplateFiles } from "./template/setup";
import {
  resolveTemplateCommitSha,
  resolveTemplateDownloadSource,
} from "./template/source-metadata";

function getNextSteps(
  projectName: string,
  install: boolean,
  packageManager: string,
  devCommand: string,
) {
  const steps: string[] = [];

  if (projectName !== ".") {
    steps.push(`cd ${projectName}`);
  }

  if (!install) {
    steps.push(`${packageManager} install${packageManager === "npm" ? " --legacy-peer-deps" : ""}`);
  }

  steps.push(devCommand, "", "See README.md for next steps");

  return steps.join("\n");
}

const main = defineCommand({
  meta: {
    name: "create-cove",
    version: packageJson.version,
    description: "Create a project with Cove Stack.",
  },
  args: cliArgs,
  async run({ args }) {
    const resolvedOptions = await resolveCliOptions(args);
    if (!resolvedOptions) return;

    let { projectName, template, install, selectedPackageManager, preferredPackageManager } =
      resolvedOptions;

    const spinner = p.spinner();
    try {
      spinner.start("Resolving template...");
      const templateConfig = getTemplateConfig(template);
      const templateCommitSha = await resolveTemplateCommitSha(templateConfig);
      const templateSource = resolveTemplateDownloadSource(templateConfig, templateCommitSha);

      spinner.message("Cloning project...");
      const { dir, source } = await downloadTemplate(templateSource, {
        dir: projectName,
        force: true,
        forceClean: true,
      });

      await prepareTemplateFiles(dir, template, projectName, templateCommitSha);

      const finalPackageManager = selectedPackageManager || preferredPackageManager;
      spinner.stop(`Project cloned from ${source}`);

      await initGitRepo(dir);

      if (install) {
        const installed = await installDependencies(dir, finalPackageManager);
        if (!installed) {
          install = false;
        }
      }

      const nextSteps = getNextSteps(
        projectName,
        install,
        finalPackageManager,
        getDevCommand(finalPackageManager),
      );

      p.note(`${nextSteps}\n${templateConfig.homeUrl}`, "Next steps");
      p.outro(`All set. Happy coding! 🚀`);
    } catch (error) {
      spinner.stop();
      console.error(error);
      p.outro("Failed to create project. Please try again.");
      process.exitCode = 1;
    }
  },
});

void runMain(main);
