import type { Template } from "../cli/args";

export interface TemplateConfig {
  source: string;
  homeUrl: string;
}

const TEMPLATE_CONFIG: Record<Template, TemplateConfig> = {
  default: {
    source: "github:mugnavo/cove",
    homeUrl: "https://github.com/mugnavo/cove",
  },
  monorepo: {
    source: "github:mugnavo/cove-monorepo",
    homeUrl: "https://github.com/mugnavo/cove-monorepo",
  },
};

export function getTemplateConfig(template: Template): TemplateConfig {
  return TEMPLATE_CONFIG[template];
}
