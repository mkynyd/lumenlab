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
    fill: "var(--color-panel)",
    stroke: "var(--color-text-tertiary)",
    text: "var(--color-text-primary)",
  },
  file: {
    fill: "var(--color-text-secondary)",
    stroke: "var(--color-text-secondary)",
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
  const selectedIdRef = useRef<string | null>(null);
  const applyGraphFocusRef = useRef<((id: string | null) => void) | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setVisible(true), 0);
    return () => window.clearTimeout(id);
  }, []);

  const graph = useMemo<VectorLibraryGraph | null>(() => data ?? null, [data]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

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

    const filteredNodes = graph.nodes
      .filter((n) => {
        if (n.type === "chunk" && !showChunks) return false;
        if (n.type === "topic" && !showTopics) return false;
        return true;
      })
      .map((n) => ({ ...n }));

    // Adaptive node scale based on viewport area and node count.
    // Larger viewports / fewer nodes -> bigger nodes; dense graphs -> smaller nodes.
    const area = Math.max(1, width * height);
    const nodeCount = Math.max(1, filteredNodes.length);
    const idealAreaPerNode = area / nodeCount;
    const nodeScale = Math.min(1.5, Math.max(0.42, Math.sqrt(idealAreaPerNode) / 38));

    const BASE_RADIUS: Record<VectorLibraryNode["type"], number> = {
      topic: 24,
      file: 16,
      chunk: 5,
    };

    function scaledRadius(d: VectorLibraryNode): number {
      const radius = d.radius || BASE_RADIUS[d.type];
      return Math.max(2, Math.round(radius * nodeScale));
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

    const centerX = width / 2;
    const centerY = height / 2;
    const shortestSide = Math.max(1, Math.min(width, height));
    const fileRingRadius = Math.max(96, Math.min(shortestSide * 0.24, 230));
    const topicRingRadius = Math.max(
      fileRingRadius + 150,
      Math.min(shortestSide * 0.42, 390)
    );
    const chunkOrbitRadius = Math.max(44, Math.min(shortestSide * 0.08, 82));

    const fileNodes = filteredNodes.filter((nodeData) => nodeData.type === "file");
    const topicNodes = filteredNodes.filter((nodeData) => nodeData.type === "topic");
    const fileNodeById = new Map(fileNodes.map((nodeData) => [nodeData.id, nodeData]));

    function placeOnRing(
      nodesToPlace: VectorLibraryNode[],
      radius: number,
      startAngle: number
    ) {
      const count = Math.max(1, nodesToPlace.length);
      nodesToPlace.forEach((nodeData, index) => {
        const angle = startAngle + (Math.PI * 2 * index) / count;
        nodeData.x = centerX + Math.cos(angle) * radius;
        nodeData.y = centerY + Math.sin(angle) * radius * 0.78;
      });
    }

    placeOnRing(fileNodes, fileRingRadius, -Math.PI / 2);
    placeOnRing(topicNodes, topicRingRadius, -Math.PI / 2 + Math.PI / Math.max(1, topicNodes.length));

    filteredNodes
      .filter((nodeData) => nodeData.type === "chunk")
      .forEach((nodeData, index) => {
        const parent = nodeData.fileId ? fileNodeById.get(nodeData.fileId) : null;
        const angle = (nodeData.chunkIndex ?? index) * 1.618;
        nodeData.x = (parent?.x ?? centerX) + Math.cos(angle) * chunkOrbitRadius;
        nodeData.y = (parent?.y ?? centerY) + Math.sin(angle) * chunkOrbitRadius;
      });

    function collisionRadius(d: VectorLibraryNode): number {
      const radius = scaledRadius(d);
      if (d.type === "file") {
        return radius + Math.max(40, fontSizeFor(d) * 3.2);
      }
      if (d.type === "topic") {
        return radius + Math.max(34, fontSizeFor(d) * 2.8);
      }
      return radius + 6 + densityFactor * 7;
    }

    interface SimLink extends d3.SimulationLinkDatum<VectorLibraryNode> {
      strength: number;
    }

    function linkEndpointId(value: string | VectorLibraryNode) {
      return typeof value === "string" ? value : value.id;
    }

    const nodeIdSet = new Set(filteredNodes.map((n) => n.id));
    const filteredLinks = graph.links.filter(
      (l) =>
        nodeIdSet.has(linkEndpointId(l.source as string | VectorLibraryNode)) &&
        nodeIdSet.has(linkEndpointId(l.target as string | VectorLibraryNode))
    ) as SimLink[];

    const neighbors = new Map<string, Set<string>>();
    for (const nodeData of filteredNodes) {
      neighbors.set(nodeData.id, new Set([nodeData.id]));
    }
    for (const linkData of filteredLinks) {
      const sourceId = linkEndpointId(linkData.source as string | VectorLibraryNode);
      const targetId = linkEndpointId(linkData.target as string | VectorLibraryNode);
      neighbors.get(sourceId)?.add(targetId);
      neighbors.get(targetId)?.add(sourceId);
    }

    // Adaptive force parameters: denser graphs need stronger repulsion and
    // shorter links so nodes don't pile up on the right or overlap.
    const densityFactor = Math.min(1, Math.sqrt(nodeCount / 80));
    const chargeStrength = -170 - densityFactor * 320;
    const linkDistance = (d: SimLink) => {
      const target = d.target as VectorLibraryNode | string;
      const targetType = typeof target === "string" ? undefined : target.type;
      const base = targetType === "chunk" ? 34 : d.strength > 0.5 ? 72 : 118;
      return base * (1 - densityFactor * 0.28) * nodeScale;
    };

    const simulation = d3
      .forceSimulation<VectorLibraryNode>(filteredNodes)
      .force(
        "link",
        d3
          .forceLink<VectorLibraryNode, SimLink>(filteredLinks)
          .id((d) => d.id)
          .distance(linkDistance)
          .strength((d) => Math.max(0.08, d.strength * (1 - densityFactor * 0.2)))
      )
      .force(
        "charge",
        d3
          .forceManyBody<VectorLibraryNode>()
          .strength((d) =>
            d.type === "chunk" ? -16 * nodeScale : d.type === "file" ? chargeStrength : chargeStrength * 0.75
          )
      )
      .force("center", d3.forceCenter(centerX, centerY))
      .force("x", d3.forceX(centerX).strength(0.028))
      .force("y", d3.forceY(centerY).strength(0.032))
      .force(
        "radial",
        d3
          .forceRadial<VectorLibraryNode>(
            (d) =>
              d.type === "topic"
                ? topicRingRadius
                : d.type === "file"
                  ? fileRingRadius
                  : fileRingRadius + chunkOrbitRadius,
            centerX,
            centerY
          )
          .strength((d) => (d.type === "file" ? 0.16 : d.type === "topic" ? 0.1 : 0.035))
      )
      .force(
        "collide",
        d3
          .forceCollide<VectorLibraryNode>()
          .radius(collisionRadius)
          .iterations(5)
      )
      .alphaDecay(0.014);

    const defs = svg.append("defs");
    const nodeFilter = defs
      .append("filter")
      .attr("id", "vector-node-depth")
      .attr("x", "-40%")
      .attr("y", "-40%")
      .attr("width", "180%")
      .attr("height", "180%");
    nodeFilter
      .append("feDropShadow")
      .attr("dx", 0)
      .attr("dy", 6)
      .attr("stdDeviation", 5)
      .attr("flood-color", "oklch(0.15 0 0 / 0.16)");

    const link = g
      .append("g")
      .attr("stroke", "var(--color-border)")
      .attr("stroke-linecap", "round")
      .selectAll("line")
      .data(filteredLinks)
      .join("line")
      .attr("class", "viz-link")
      .attr("stroke-opacity", (d: SimLink) => (d.strength > 0.5 ? 0.5 : 0.28))
      .attr("stroke-width", (d: SimLink) => (d.strength > 0.5 ? 1.1 : 0.8));

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
        applyFocus(d.id);
      })
      .on("mousemove", function (event: MouseEvent) {
        setTooltip((prev) => ({ ...prev, x: event.clientX, y: event.clientY }));
      })
      .on("mouseleave", function () {
        setTooltip((prev) => ({ ...prev, visible: false }));
        applyFocus(selectedIdRef.current);
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
        applyFocus(d.id);
      })
      .on("blur", function () {
        d3.select(this).select(".focus-ring").attr("stroke", "transparent").attr("stroke-opacity", 0);
        setTooltip((prev) => ({ ...prev, visible: false }));
        applyFocus(selectedIdRef.current);
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
        d.type === "chunk" ? 0 : Math.max(1, 1.4 * nodeScale)
      )
      .attr("filter", (d: VectorLibraryNode) => (d.type === "file" ? "url(#vector-node-depth)" : null));

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

    function renderTick() {
      link
        .attr("x1", (d: SimLink) => (d.source as VectorLibraryNode).x ?? 0)
        .attr("y1", (d: SimLink) => (d.source as VectorLibraryNode).y ?? 0)
        .attr("x2", (d: SimLink) => (d.target as VectorLibraryNode).x ?? 0)
        .attr("y2", (d: SimLink) => (d.target as VectorLibraryNode).y ?? 0);

      node.attr(
        "transform",
        (d: VectorLibraryNode) => `translate(${(d.x ?? 0).toFixed(1)},${(d.y ?? 0).toFixed(1)})`
      );
    }

    simulation.on("tick", renderTick);

    simulation.on("end", () => {
      fitToView();
    });

    function selectNode(d: VectorLibraryNode) {
      selectedIdRef.current = d.id;
      setSelectedId(d.id);
      setLiveMessage(
        `已选择 ${d.type === "topic" ? "主题" : d.type === "file" ? "文件" : "片段"}: ${d.label}`
      );
      applyFocus(d.id);
    }

    function applyFocus(activeId: string | null) {
      const activeNeighbors = activeId ? neighbors.get(activeId) : null;
      node
        .transition()
        .duration(140)
        .style("opacity", (n: VectorLibraryNode) =>
          !activeNeighbors || activeNeighbors.has(n.id) ? 1 : 0.28
        );
      node
        .select<SVGCircleElement>(".viz-circle")
        .transition()
        .duration(140)
        .attr("stroke", (n: VectorLibraryNode) =>
          activeId === n.id ? "var(--color-accent)" : NODE_COLORS[n.type].stroke
        )
        .attr("stroke-width", (n: VectorLibraryNode) => {
          const base = n.type === "chunk" ? 0 : Math.max(1, 1.4 * nodeScale);
          return activeId === n.id ? (n.type === "chunk" ? 2 : 3) : base;
        });
      link
        .transition()
        .duration(140)
        .attr("stroke", (l: SimLink) =>
          activeId && linkTouches(l, activeId) ? "var(--color-accent)" : "var(--color-border)"
        )
        .attr("stroke-opacity", (l: SimLink) => {
          if (!activeId) return l.strength > 0.5 ? 0.5 : 0.28;
          return linkTouches(l, activeId) ? 0.72 : 0.08;
        })
        .attr("stroke-width", (l: SimLink) => {
          if (!activeId) return l.strength > 0.5 ? 1.1 : 0.8;
          return linkTouches(l, activeId) ? 1.7 : 0.7;
        });
    }

    function linkTouches(linkData: SimLink, id: string) {
      const sourceId = linkEndpointId(linkData.source as string | VectorLibraryNode);
      const targetId = linkEndpointId(linkData.target as string | VectorLibraryNode);
      return sourceId === id || targetId === id;
    }

    applyGraphFocusRef.current = applyFocus;

    // Fit the graph into the viewport with padding, avoiding the empty-right-edge
    // issue when the simulation drifts or the viewport is wide.
    function fitToView(padding = 80) {
      const bounds = g.node()?.getBBox();
      if (!bounds || bounds.width === 0 || bounds.height === 0) return;

      const fullWidth = width;
      const fullHeight = height;
      const availableWidth = fullWidth - padding * 2;
      const availableHeight = fullHeight - padding * 2;
      const scale = Math.min(
        availableWidth / bounds.width,
        availableHeight / bounds.height,
        1.15
      );
      const translateX = fullWidth / 2 - scale * (bounds.x + bounds.width / 2);
      const translateY = fullHeight / 2 - scale * (bounds.y + bounds.height / 2);

      svg
        .transition()
        .duration(240)
        .ease(d3.easeCubicOut)
        .call(
          zoom.transform as never,
          d3.zoomIdentity.translate(translateX, translateY).scale(scale)
        );
    }

    simulation.tick(Math.min(220, 80 + nodeCount));
    renderTick();
    fitToView();

    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        selectedIdRef.current = null;
        setSelectedId(null);
        setLiveMessage("选择已清除");
        applyFocus(null);
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
      applyGraphFocusRef.current = null;
    };
  }, [graph, showChunks, showTopics, sizeKey]);

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
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-project-control)] text-[var(--color-text-secondary)]">
            <Network width={18} height={18} strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
              资料图谱
            </h2>
            <p className="truncate text-[11px] text-[var(--color-text-tertiary)]">
              {projectName}
              {graph ? (
                <>
                  <span className="mx-1.5 text-[var(--color-border)]">/</span>
                  {graph.stats.fileCount} 文件 · {graph.stats.topicCount} 主题 · {graph.stats.chunkCount} 片段
                </>
              ) : null}
            </p>
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
        <div
          ref={wrapperRef}
          className="relative flex-1 overflow-hidden bg-[var(--color-bg)]"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at 50% 42%, var(--color-surface) 0, transparent 38%), radial-gradient(circle at 50% 50%, var(--color-project-control) 0 1px, transparent 1.4px)",
              backgroundSize: "100% 100%, 28px 28px",
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[var(--color-panel)] to-transparent opacity-70"
          />
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
            className="relative h-full w-full"
            role="img"
            aria-label="项目资料力导向图，可使用 Tab 键在节点间切换并按 Enter 选中"
          />
          {/* Legend */}
          <div className="pointer-events-none absolute left-4 top-4 rounded-[var(--radius-sm)] bg-[var(--color-panel)] p-3 shadow-[var(--shadow-panel)]">
            <div className="mb-1.5 text-[11px] font-medium text-[var(--color-text-primary)]">
              图例
            </div>
            <LegendItem label="主题" color="var(--color-panel)" border />
            <LegendItem label="文件" color="var(--color-text-secondary)" size={10} />
            <LegendItem label="片段" color="var(--color-border)" size={5} />
            <LegendItem label="失败" color="var(--color-error)" size={8} failed />
          </div>
          <div className="pointer-events-none absolute bottom-4 left-4 max-w-[280px] rounded-[var(--radius-sm)] bg-[var(--color-panel)] px-3 py-2 text-[11px] leading-relaxed text-[var(--color-text-tertiary)] shadow-[var(--shadow-panel)]">
            滚轮缩放，拖动画布平移。选中节点会保留它的直接关系。
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
                  onClick={() => {
                    selectedIdRef.current = null;
                    setSelectedId(null);
                    applyGraphFocusRef.current?.(null);
                  }}
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
