import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getDocument = vi.hoisted(() => vi.fn());

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument,
  GlobalWorkerOptions: { workerSrc: "" },
}));

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  observed: Element[] = [];

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe(element: Element) {
    this.observed.push(element);
  }

  unobserve(element: Element) {
    this.observed = this.observed.filter((item) => item !== element);
  }

  disconnect() {
    this.observed = [];
  }

  trigger(targets: Element[]) {
    this.callback(targets.map((target) => ({ isIntersecting: true, target }) as IntersectionObserverEntry), this as unknown as IntersectionObserver);
  }
}

function makeDocument(numPages: number) {
  const getPage = vi.fn(async () => ({
    getViewport: () => ({ width: 300, height: 400 }),
    render: () => ({ promise: Promise.resolve() }),
  }));
  return { numPages, getPage, destroy: vi.fn(async () => undefined) };
}

import { PaperPdfViewer } from "./paper-pdf-viewer";

describe("PaperPdfViewer", () => {
  beforeEach(() => {
    MockIntersectionObserver.instances = [];
    getDocument.mockReset();
    getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 0, destroy: vi.fn(async () => undefined) }) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("passes pdf.js the CMap and standard-font tables so CJK glyphs render", async () => {
    render(<PaperPdfViewer pdfUrl="/api/papers/compilations/c1/pdf" />);

    await waitFor(() => expect(getDocument).toHaveBeenCalled());
    expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
    }));
  });

  it("只光栅化进入视口范围的页面，而不是一次性渲染全部页面", async () => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as unknown as CanvasRenderingContext2D);
    const document = makeDocument(3);
    getDocument.mockReturnValue({ promise: Promise.resolve(document) });

    render(<PaperPdfViewer pdfUrl="/api/papers/compilations/c1/pdf" />);
    await screen.findByText("第 1 页加载中…");
    await waitFor(() => expect(MockIntersectionObserver.instances.length).toBeGreaterThan(0));

    const observer = MockIntersectionObserver.instances[MockIntersectionObserver.instances.length - 1];
    expect(observer.observed).toHaveLength(3);
    expect(document.getPage).not.toHaveBeenCalled();

    observer.trigger([observer.observed[0]]);
    await waitFor(() => expect(document.getPage).toHaveBeenCalledWith(1));
    expect(document.getPage).toHaveBeenCalledTimes(1);

    observer.trigger([observer.observed[2]]);
    await waitFor(() => expect(document.getPage).toHaveBeenCalledWith(3));
  });

  it("在没有 IntersectionObserver 的环境下退化为按需渲染全部页面", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as unknown as CanvasRenderingContext2D);
    const document = makeDocument(2);
    getDocument.mockReturnValue({ promise: Promise.resolve(document) });

    render(<PaperPdfViewer pdfUrl="/api/papers/compilations/c1/pdf" />);

    await waitFor(() => expect(document.getPage).toHaveBeenCalledWith(1));
    await waitFor(() => expect(document.getPage).toHaveBeenCalledWith(2));
  });
});
