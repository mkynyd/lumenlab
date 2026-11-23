"use client";

import IntelligentSurface from "@/components/chat/intelligent-ui/surface";
import { makeSurface, type UISurface } from "@/lib/chat/intelligent-ui/surface-data";

const OHM_LAB: UISurface = makeSurface("landing-ohm-lab", [
  {
    id: "controls",
    state: [{ name: "resistance", kind: "number", initial: 4, min: 1, max: 10, step: 1 }],
    nodes: [
      { id: "intro", type: "text", props: { text: "电压恒为 6 V。拖动电阻，观察电流与功率如何变化。" } },
      { id: "resistance", type: "slider", props: { label: "电阻 R（Ω）", bind: "resistance" } },
    ],
  },
  {
    id: "readout",
    nodes: [
      { id: "current", type: "value", props: { label: "电流 I", value: { op: "/", args: [6, { ref: "resistance" }] }, unit: "A", digits: 2 } },
      { id: "power", type: "value", props: { label: "功率 P", value: { op: "/", args: [36, { op: "*", args: [{ ref: "resistance" }, { ref: "resistance" }] }] }, unit: "W", digits: 2 } },
      {
        id: "chart",
        type: "bar",
        props: {
          label: "当前读数",
          unit: "A / W",
          source: "demo",
          labels: ["电流 A", "功率 W"],
          series: [
            {
              label: "当前值",
              values: [
                { op: "/", args: [6, { ref: "resistance" }] },
                { op: "/", args: [36, { op: "*", args: [{ ref: "resistance" }, { ref: "resistance" }] }] },
              ],
            },
          ],
        },
      },
      { id: "note", type: "text", props: { text: "**演示数据**：理想电阻，忽略温度与电源内阻。" } },
    ],
  },
]);

/**
 * 与 /chat 共用的真实智能界面渲染器，只换数据源。
 * 不启动 INP 上报，避免把落地页和文档访客计入聊天面板样本。
 */
export function OhmLabDemo() {
  return <IntelligentSurface surface={OHM_LAB} reportInp={false} />;
}
