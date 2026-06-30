"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useVectorLibrary } from "@/lib/hooks/use-vector-library";
import { LoadingIndicator } from "@/components/workbench/loading-indicator";
import {
  Network,
  Xmark,
  WarningTriangle,
  RefreshDouble,
  NavArrowDown,
  NavArrowUp,
} from "iconoir-react";
import type { VectorLibraryNode, VectorLibraryGraph } from "@/lib/api/types";
import { VectorTooltip, type VectorTooltipState } from "./vector-tooltip";

interface VectorLibraryViewProps {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onReparseFile?: (fileId: string) => void;
}

const NODE_COLORS: Record<
  VectorLibraryNode["type"],
  { fill: string; stroke: string; text: string }
> = {
  topic: {
    fill: "var(--color-text-tertiary)",
    stroke: "var(--color-text-tertiary)",
    text: "var(--color-bg)",
  },
  file: {
    fill: "var(--color-panel)",
    stroke: "var(--color-border)",
    text: "var(--color-text-primary)",
  },
  chunk: {
    fill: "var(--color-border)",
    stroke: "var(--color-border)",
    text: "var(--color-text-secondary)",
  },
};

export function VectorLibraryView({
  projectId,
  projectName,
  onClose,
  onReparseFile,
}: VectorLibraryViewProps) {
  const { data, isPending, error } = useVectorLibrary(projectId);
  const [visible, setVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showChunks, setShowChunks] = useState(true);
  const [showTopics, setShowTopics] = useState(true);
  const [tooltip, setTooltip] = useState<VectorTooltipState>({
    visible: false,
    x: 0,
    y: 0,
    title: "",
    lines: [],
  });
  const [liveMessage, setLiveMessage] = useState("");
  const [sizeKey, setSizeKey] = useState(0);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setVisible(true), 0);
    return () => window.clearTimeout(id);
  }, []);

  const graph = useMemo<VectorLibraryGraph | null>(() => data ?? null, [data]);

  function tooltipLines(d: VectorLibraryNode): string[] {
    switch (d.type) {
      case "topic":
        return d.keywords ? [`关联文件: ${d.keywords.length}`] : [];
      case "file":
        return [
          `状态: ${d.status || "未知"}`,
          d.processingError ? `错误: ${d.processingError}` : "",
        ].filter(Boolean);
      case "chunk":
        return [d.content ? `${d.content.slice(0, 80)}…` : ""].filter(Boolean);
    }
  }

  useEffect(() => {
    if (!graph || !svgRef.current || !wrapperRef.current) return;

    const svg = d3.select(svgRef.current);
    const wrapper = wrapperRef.current;

    const width = wrapper.clientWidth;
    const height = wrapper.clientHeight;

    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    svg.attr("width", width);
    svg.attr("height", height);

    const g = svg.append("g");

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 6])
      .on("zoom", (event) => {
        g.attr("transform", event.transform.toString());
      });
    svg.call(zoom as never);

    const filteredNodes = graph.nodes.filter((n) => {
      if (n.type === "chunk" && !showChunks) return false;
      if (n.type === "topic" && !showTopics) return false;
      return true;
    });

    // Adaptive node scale based on viewport area and node count.
    // Larger viewports / fewer nodes → bigger nodes; dense graphs → smaller nodes.
    const area = Math.max(1, width * height);
    const nodeCount = Math.max(1, filteredNodes.length);
    const idealAreaPerNode = area / nodeCount;
    const nodeScale = Math.min(1.35, Math.max(0.38, Math.sqrt(idealAreaPerNode) / 42));

    const BASE_RADIUS: Record<VectorLibraryNode["type"], number> = {
      topic: 24,
      file: 16,
      chunk: 5,
    };

    function scaledRadius(d: VectorLibraryNode): number {
      return Math.max(2, Math.round(BASE_RADIUS[d.type] * nodeScale));
    }

    function fontSizeFor(d: VectorLibraryNode): number {
      if (d.type === "chunk") return 0;
      const base = d.type === "topic" ? 13 : 12;
      return Math.max(9, Math.round(base * Math.min(nodeScale * 1.1, 1.15)));
    }

    function labelMaxChars(d: VectorLibraryNode): number {
      if (d.type === "topic") return Math.max(4, Math.round(8 * Math.min(nodeScale * 1.2, 1.4)));
      return Math.max(6, Math.round(16 * Math.min(nodeScale * 1.15, 1.3)));
    }

    interface SimLink extends d3.SimulationLinkDatum<VectorLibraryNode> {
      strength: number;
    }

    const nodeIdSet = new Set(filteredNodes.map((n) => n.id));
    const filteredLinks = graph.links.filter(
      (l) => nodeIdSet.has(l.source as string) && nodeIdSet.has(l.target as string)
    ) as SimLink[];

    // Adaptive force parameters: denser graphs need stronger repulsion and
    // shorter links so nodes don't pile up on the right or overlap.
    const densityFactor = Math.min(1, Math.sqrt(nodeCount / 80));
    const chargeStrength = -120 - densityFactor * 240;
    const linkDistance = (d: SimLink) => {
      const base = d.strength > 0.5 ? 45 : 100;
      return base * (1 - densityFactor * 0.35);
    };

    const simulation = d3
      .forceSimulation<VectorLibraryNode>(filteredNodes)
      .force(
        "link",
        d3
          .forceLink<VectorLibraryNode, SimLink>(filteredLinks)
          .id((d) => d.id)
          .distance(linkDistance)
          .strength((d) => d.strength * (1 - densityFactor * 0.25))
      )
      .force(
        "charge",
        d3
          .forceManyBody<VectorLibraryNode>()
          .strength((d) => (d.type === "chunk" ? -20 * nodeScale : chargeStrength))
      )
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force(
        "collide",
        d3
          .forceCollide<VectorLibraryNode>()
          .radius((d) => scaledRadius(d) + 4 + densityFactor * 6)
          .iterations(2)
      )
      .alphaDecay(0.02);

    const link = g
      .append("g")
      .attr("stroke", "var(--color-border)")
      .attr("stroke-opacity", 0.6)
      .selectAll("line")
      .data(filteredLinks)
      .join("line")
      .attr("stroke-width", 1);

    const node = g
      .append("g")
      .selectAll<SVGGElement, VectorLibraryNode>("g")
      .data(filteredNodes, (d: VectorLibraryNode) => d.id)
      .join("g")
      .attr("class", "viz-node")
      .attr("role", "button")
      .attr("tabindex", 0)
      .attr("aria-label", (d: VectorLibraryNode) => {
        const status = d.status && d.status !== "parsed" ? `，状态 ${d.status}` : "";
        return `${d.type === "topic" ? "主题" : d.type === "file" ? "文件" : "片段"}: ${d.label}${status}`;
      })
      .style("cursor", "pointer")
      .on("mouseenter", function (event: MouseEvent, d: VectorLibraryNode) {
        setTooltip({
          visible: true,
          x: event.clientX,
          y: event.clientY,
          title: d.label,
          lines: tooltipLines(d),
        });
        d3.select(this)
          .select(".viz-circle")
          .attr("stroke", "var(--color-accent)")
          .attr("stroke-width", d.type === "chunk" ? 2 : 3);
      })
      .on("mousemove", function (event: MouseEvent) {
        setTooltip((prev) => ({ ...prev, x: event.clientX, y: event.clientY }));
      })
      .on("mouseleave", function (_event: MouseEvent, d: VectorLibraryNode) {
        setTooltip((prev) => ({ ...prev, visible: false }));
        const isSelected = selectedId === d.id;
        d3.select(this)
          .select(".viz-circle")
          .attr("stroke", isSelected ? "var(--color-accent)" : NODE_COLORS[d.type].stroke)
          .attr("stroke-width", isSelected ? 3 : d.type === "chunk" ? 0 : Math.max(1, 1.5 * nodeScale));
      })
      .on("click", (_event: MouseEvent, d: VectorLibraryNode) => selectNode(d))
      .on("keydown", function (event: KeyboardEvent, d: VectorLibraryNode) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectNode(d);
        }
      })
      .on("focus", function (_event: FocusEvent, d: VectorLibraryNode) {
        d3.select(this)
          .select(".focus-ring")
          .attr("stroke", "var(--color-accent)")
          .attr("stroke-opacity", 0.8);
        setTooltip({
          visible: true,
          x: d.x ?? 0,
          y: (d.y ?? 0) - scaledRadius(d) - 8,
          title: d.label,
          lines: tooltipLines(d),
        });
      })
      .on("blur", function () {
        d3.select(this).select(".focus-ring").attr("stroke", "transparent").attr("stroke-opacity", 0);
        setTooltip((prev) => ({ ...prev, visible: false }));
      });

    // Focus ring (rendered behind visible circle)
    node
      .append("circle")
      .attr("class", "focus-ring")
      .attr("r", (d: VectorLibraryNode) => scaledRadius(d) + 5)
      .attr("fill", "transparent")
      .attr("stroke", "transparent")
      .attr("stroke-width", 2)
      .attr("stroke-opacity", 0)
      .attr("aria-hidden", "true");

    // Visible node circle
    node
      .append("circle")
      .attr("class", "viz-circle")
      .attr("r", (d: VectorLibraryNode) => scaledRadius(d))
      .attr("fill", (d: VectorLibraryNode) =>
        d.status === "failed" ? "var(--color-error-muted)" : NODE_COLORS[d.type].fill
      )
      .attr("stroke", (d: VectorLibraryNode) =>
        d.status === "failed" ? "var(--color-error)" : NODE_COLORS[d.type].stroke
      )
      .attr("stroke-width", (d: VectorLibraryNode) =>
        d.type === "chunk" ? 0 : Math.max(1, 1.5 * nodeScale)
      );

    // Failed icon
    node
      .filter((d: VectorLibraryNode) => d.status === "failed")
      .append("text")
      .attr("dy", 1)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--color-error)")
      .attr("font-size", () => Math.max(8, Math.round(10 * nodeScale)))
      .attr("aria-hidden", "true")
      .text("!");

    // Labels for topic/file with readable backing
    node
      .filter((d: VectorLibraryNode) => d.type !== "chunk")
      .append("text")
      .attr("class", "viz-label")
      .attr("dy", (d: VectorLibraryNode) => scaledRadius(d) + 14)
      .attr("text-anchor", "middle")
      .attr("fill", (d: VectorLibraryNode) => NODE_COLORS[d.type].text)
      .attr("font-size", (d: VectorLibraryNode) => fontSizeFor(d))
      .attr("font-weight", (d: VectorLibraryNode) => (d.type === "topic" ? 600 : 500))
      .attr("paint-order", "stroke")
      .attr("stroke", "var(--color-bg)")
      .attr("stroke-width", 3)
      .attr("stroke-opacity", 0.85)
      .style("pointer-events", "none")
      .text((d: VectorLibraryNode) => truncateLabel(d.label, labelMaxChars(d)));

    simulation.on("tick", () => {
      link
        .attr("x1", (d: SimLink) => (d.source as VectorLibraryNode).x ?? 0)
        .attr("y1", (d: SimLink) => (d.source as VectorLibraryNode).y ?? 0)
        .attr("x2", (d: SimLink) => (d.target as VectorLibraryNode).x ?? 0)
        .attr("y2", (d: SimLink) => (d.target as VectorLibraryNode).y ?? 0);

      node.attr(
        "transform",
        (d: VectorLibraryNode) => `translate(${(d.x ?? 0).toFixed(1)},${(d.y ?? 0).toFixed(1)})`
      );
    });

    simulation.on("end", () => {
      fitToView();
    });

    function selectNode(d: VectorLibraryNode) {
      setSelectedId(d.id);
      setLiveMessage(
        `已选择 ${d.type === "topic" ? "主题" : d.type === "file" ? "文件" : "片段"}: ${d.label}`
      );
      svg
        .selectAll<SVGGElement, VectorLibraryNode>(".viz-node")
        .select(".viz-circle")
        .attr("stroke", (n) =>
          n.id === d.id ? "var(--color-accent)" : NODE_COLORS[n.type].stroke
        )
        .attr("stroke-width", (n) => {
          const base = n.type === "chunk" ? 0 : Math.max(1, 1.5 * nodeScale);
          return n.id === d.id ? 3 : base;
        });
    }

    // Fit the graph into the viewport with padding, avoiding the empty-right-edge
    // issue when the simulation drifts or the viewport is wide.
    function fitToView(padding = 48) {
      const bounds = g.node()?.getBBox();
      if (!bounds || bounds.width === 0 || bounds.height === 0) return;

      const fullWidth = width;
      const fullHeight = height;
      const availableWidth = fullWidth - padding * 2;
      const availableHeight = fullHeight - padding * 2;
      const scale = Math.min(
        availableWidth / bounds.width,
        availableHeight / bounds.height,
        1.6
      );
      const translateX = fullWidth / 2 - scale * (bounds.x + bounds.width / 2);
      const translateY = fullHeight / 2 - scale * (bounds.y + bounds.height / 2);

      svg
        .transition()
        .duration(350)
        .ease(d3.easeCubicOut)
        .call(
          zoom.transform as never,
          d3.zoomIdentity.translate(translateX, translateY).scale(scale)
        );
    }

    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedId(null);
        setLiveMessage("选择已清除");
      }
    };
    window.addEventListener("keydown", keyHandler);

    // Re-run the graph layout when the container size changes meaningfully so
    // the viewport is always filled and the graph stays centered.
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width: newWidth, height: newHeight } = entry.contentRect;
      if (Math.abs(newWidth - width) > 8 || Math.abs(newHeight - height) > 8) {
        setSizeKey((k) => k + 1);
      }
    });
    resizeObserver.observe(wrapper);

    return () => {
      simulation.stop();
      window.removeEventListener("keydown", keyHandler);
      resizeObserver.disconnect();
    };
  }, [graph, showChunks, showTopics, selectedId, sizeKey]);

  const selectedNode = useMemo<VectorLibraryNode | null>(
    () => graph?.nodes.find((n) => n.id === selectedId) || null,
    [graph, selectedId]
  );

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex flex-col bg-[var(--color-bg)]",
        "transition-opacity duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
        visible ? "opacity-100" : "opacity-0"
      )}
      role="dialog"
      aria-modal="true"
      aria-label={`${projectName} 的资料图谱`}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border-light)] bg-[var(--color-panel)] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-project-control)] text-[var(--color-text-secondary)]">
            <Network width={18} height={18} strokeWidth={1.8} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
              资料图谱
            </h2>
            <p className="text-[11px] text-[var(--color-text-tertiary)]">{projectName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LayerToggle active={showTopics} onClick={() => setShowTopics((v) => !v)} label="主题" />
          <LayerToggle active={showChunks} onClick={() => setShowChunks((v) => !v)} label="片段" />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              setVisible(false);
              window.setTimeout(onClose, 300);
            }}
            aria-label="关闭资料图谱"
          >
            <Xmark width={18} height={18} strokeWidth={2} />
          </Button>
        </div>
      </div>

      {/* Main workspace */}
      <div className="relative flex min-h-0 flex-1">
        {/* Graph stage */}
        <div ref={wrapperRef} className="relative flex-1 overflow-hidden">
          {isPending && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--color-bg)]/80">
              <LoadingIndicator size="md" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <div className="rounded-[var(--radius-md)] bg-[var(--color-error-muted)] px-4 py-3 text-sm text-[var(--color-error)]">
                加载资料图谱失败，请稍后重试
              </div>
            </div>
          )}
          <svg
            ref={svgRef}
            className="h-full w-full"
            role="img"
            aria-label="项目资料力导向图，可使用 Tab 键在节点间切换并按 Enter 选中"
          />
          {/* Legend */}
          <div className="pointer-events-none absolute left-4 top-4 rounded-[var(--radius-sm)] bg-[var(--color-panel)]/95 p-3 shadow-[var(--shadow-panel)] backdrop-blur-sm">
            <div className="mb-1.5 text-[11px] font-medium text-[var(--color-text-primary)]">
              图例
            </div>
            <LegendItem label="主题" color="var(--color-text-tertiary)" size={10} />
            <LegendItem label="文件" color="var(--color-panel)" border />
            <LegendItem label="片段" color="var(--color-border)" size={5} />
            <LegendItem label="失败" color="var(--color-error)" size={8} failed />
          </div>
        </div>

        {/* Inspector */}
        <aside
          className={cn(
            "absolute inset-y-0 right-0 z-10 w-[280px] border-l border-[var(--color-border-light)] bg-[var(--color-panel)]",
            "transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
            selectedNode ? "translate-x-0" : "translate-x-full"
          )}
          aria-hidden={!selectedNode}
        >
          {selectedNode ? (
            <div className="flex h-full flex-col p-4">
              <div className="mb-3 flex items-start justify-between gap-2">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                    selectedNode.type === "topic" &&
                      "bg-[var(--color-text-tertiary)] text-[var(--color-bg)]",
                    selectedNode.type === "file" &&
                      "bg-[var(--color-project-control)] text-[var(--color-text-secondary)]",
                    selectedNode.type === "chunk" &&
                      "bg-[var(--color-border-light)] text-[var(--color-text-secondary)]"
                  )}
                >
                  {selectedNode.type === "topic"
                    ? "主题"
                    : selectedNode.type === "file"
                      ? "文件"
                      : "片段"}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                  aria-label="关闭检查器"
                >
                  <Xmark width={16} height={16} strokeWidth={2} />
                </button>
              </div>
              <h3 className="mb-2 break-words text-sm font-semibold text-[var(--color-text-primary)]">
                {selectedNode.label}
              </h3>
              {selectedNode.status && (
                <p className="mb-3 text-xs text-[var(--color-text-secondary)]">
                  状态: {selectedNode.status}
                </p>
              )}
              {selectedNode.processingError && (
                <div className="mb-3 rounded-[var(--radius-sm)] bg-[var(--color-error-muted)] p-2.5 text-xs text-[var(--color-error)]">
                  <div className="mb-1 flex items-center gap-1 font-medium">
                    <WarningTriangle width={12} height={12} strokeWidth={2} />
                    解析失败
                  </div>
                  {selectedNode.processingError}
                  {onReparseFile && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="mt-2 h-7 text-xs"
                      onClick={() => onReparseFile(selectedNode.fileId!)}
                    >
                      <RefreshDouble
                        width={14}
                        height={14}
                        strokeWidth={2}
                        className="mr-1"
                      />
                      重新解析
                    </Button>
                  )}
                </div>
              )}
              {selectedNode.content && (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-text-secondary)]">
                    {selectedNode.content}
                  </p>
                </div>
              )}
              {selectedNode.keywords && selectedNode.keywords.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {selectedNode.keywords.map((k) => (
                    <span
                      key={k}
                      className="rounded-md bg-[var(--color-project-control)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-secondary)]"
                    >
                      {k}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <Network
                width={32}
                height={32}
                strokeWidth={1.5}
                className="mb-2 text-[var(--color-text-tertiary)]"
              />
              <p className="text-xs text-[var(--color-text-secondary)]">
                点击或按 Enter 选中节点查看详情
              </p>
            </div>
          )}
        </aside>
      </div>

      {/* Screen-reader live region */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {liveMessage}
      </div>

      <VectorTooltip state={tooltip} />
    </div>
  );
}

function LayerToggle({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-7 gap-1 rounded-[var(--radius-sm)] border-0 px-2 text-xs",
        active
          ? "bg-[var(--color-project-surface-active)] text-[var(--color-text-primary)]"
          : "bg-[var(--color-project-control)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
      )}
    >
      {active ? (
        <NavArrowDown width={12} height={12} />
      ) : (
        <NavArrowUp width={12} height={12} />
      )}
      {label}
    </Button>
  );
}

function LegendItem({
  label,
  color,
  size = 8,
  border,
  failed,
}: {
  label: string;
  color: string;
  size?: number;
  border?: boolean;
  failed?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <svg width={size * 2} height={size * 2} className="shrink-0">
        <circle
          cx={size}
          cy={size}
          r={size}
          fill={color}
          stroke={failed ? color : border ? "var(--color-border)" : "none"}
          strokeWidth={border ? 1.5 : 0}
        />
      </svg>
      <span className="text-[11px] text-[var(--color-text-secondary)]">{label}</span>
    </div>
  );
}

function truncateLabel(label: string, maxChars: number) {
  if (label.length <= maxChars) return label;
  return `${label.slice(0, maxChars - 1)}…`;
}
