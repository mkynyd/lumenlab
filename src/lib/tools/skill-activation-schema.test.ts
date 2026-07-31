import { afterEach, describe, expect, it } from "vitest";

import { skillRegistry } from "@/lib/agent/skill-registry";
import { toolRegistry } from "@/lib/agent/tool-registry";
import type { SkillMetadata } from "@/lib/agent/types";
import { refreshActivateSkillSchema } from "@/lib/tools/registry";

const originalSkills = skillRegistry.list();

afterEach(() => {
  skillRegistry.reset();
  for (const skill of originalSkills) skillRegistry.register(skill);
  refreshActivateSkillSchema();
});

describe("skill.activate discovery schema", () => {
  it("refreshes the enum after asynchronous discovery changes the registry", () => {
    skillRegistry.reset();
    skillRegistry.register({
      skillId: "fixture-skill",
      version: "1",
      description: "fixture",
      instructions: "fixture",
      allowedTools: [],
      allowedRiskLevel: ["L1"],
      requiredScopes: [],
      defaultApprovalPolicy: "auto",
      inputContract: {},
      outputContract: {},
      dataHandlingPolicy: { maySendToExternal: false, mayPersist: false },
      category: "test",
    } satisfies SkillMetadata);

    refreshActivateSkillSchema();

    const activateTool = toolRegistry.require("skill.activate");
    const properties = (
      activateTool.inputSchema as {
        properties: { name: { enum: string[] } };
      }
    ).properties;
    expect(properties.name.enum).toEqual(["fixture-skill"]);
  });
});
