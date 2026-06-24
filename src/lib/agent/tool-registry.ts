/**
 * Tool 中央注册表
 *
 * Tool 元数据是静态、不可变的：风险等级与审批策略由 Tool 自身定义，
 * Policy Engine 不会根据 Skill/上下文自动放宽。
 */

import type { ToolMetadata } from "./types";

class ToolRegistry {
  private readonly tools = new Map<string, ToolMetadata>();

  register(metadata: ToolMetadata): void {
    if (this.tools.has(metadata.toolId)) {
      throw new Error(`Tool already registered: ${metadata.toolId}`);
    }
    this.tools.set(metadata.toolId, metadata);
  }

  has(toolId: string): boolean {
    return this.tools.has(toolId);
  }

  get(toolId: string): ToolMetadata | undefined {
    return this.tools.get(toolId);
  }

  require(toolId: string): ToolMetadata {
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new Error(`Tool not registered: ${toolId}`);
    }
    return tool;
  }

  list(): ToolMetadata[] {
    return [...this.tools.values()];
  }

  reset(): void {
    this.tools.clear();
  }
}

export const toolRegistry = new ToolRegistry();