import { afterEach, describe, expect, it } from "vitest";
import { mermaidRuntimeHtml } from "./html.gen";
import { parseMermaidRuntimeMessage, type MermaidRuntimeMessage } from "./messages";

const mountedFrames: HTMLIFrameElement[] = [];

function waitForRuntimeMessage(
  frame: HTMLIFrameElement,
  predicate: (message: MermaidRuntimeMessage) => boolean,
): Promise<MermaidRuntimeMessage> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", receive);
      reject(new Error("Timed out waiting for Mermaid runtime"));
    }, 10_000);
    function receive(event: MessageEvent): void {
      if (event.source !== frame.contentWindow) {
        return;
      }
      const message = parseMermaidRuntimeMessage(event.data);
      if (!message || !predicate(message)) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
      resolve(message);
    }
    window.addEventListener("message", receive);
  });
}

async function mountRuntime(options: { inspectable?: boolean } = {}): Promise<HTMLIFrameElement> {
  const frame = document.createElement("iframe");
  frame.sandbox.add("allow-scripts");
  if (options.inspectable) {
    // Same origin lets the test read the drawn SVG; the hosts never grant it.
    frame.sandbox.add("allow-same-origin");
  }
  const ready = waitForRuntimeMessage(frame, (message) => message.type === "bridgeReady");
  frame.srcdoc = mermaidRuntimeHtml;
  document.body.append(frame);
  mountedFrames.push(frame);
  await ready;
  return frame;
}

function diagramSvg(frame: HTMLIFrameElement): SVGSVGElement {
  const svg = frame.contentDocument?.querySelector<SVGSVGElement>("#diagram svg");
  if (!svg) {
    throw new Error("Runtime drew no SVG");
  }
  return svg;
}

function computedFill(frame: HTMLIFrameElement, element: Element): number[] {
  const fill = frame.contentWindow?.getComputedStyle(element).fill ?? "";
  const channels = fill
    .match(/\d+(\.\d+)?/g)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length !== 3) {
    throw new Error(`Unexpected fill "${fill}"`);
  }
  return channels;
}

function labelBrightness(frame: HTMLIFrameElement, label: string): number {
  const text = Array.from(diagramSvg(frame).querySelectorAll("text")).find(
    (element) => element.textContent === label,
  );
  if (!text) {
    throw new Error(`No label "${label}" in the diagram`);
  }
  return computedFill(frame, text).reduce((sum, channel) => sum + channel, 0) / (3 * 255);
}

// WCAG contrast ratio between two sRGB colors with 0-255 channels.
function contrastRatio(first: number[], second: number[]): number {
  const luminance = (rgb: number[]) => {
    const [red, green, blue] = rgb.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

function render(
  frame: HTMLIFrameElement,
  input: { revision: number; source: string; colorScheme?: "light" | "dark" },
): Promise<MermaidRuntimeMessage> {
  const response = waitForRuntimeMessage(
    frame,
    (message) =>
      message.type !== "bridgeReady" &&
      "revision" in message &&
      message.revision === input.revision,
  );
  frame.contentWindow?.postMessage(
    {
      type: "render",
      revision: input.revision,
      source: input.source,
      colorScheme: input.colorScheme ?? "dark",
      interactive: false,
    },
    "*",
  );
  return response;
}

afterEach(() => {
  for (const frame of mountedFrames.splice(0)) {
    frame.remove();
  }
});

describe("Mermaid sandbox runtime", () => {
  it("renders successive valid streaming prefixes and reports an invalid prefix", async () => {
    const frame = await mountRuntime();
    const firstSource = "flowchart TD\nA --> B";
    const secondSource = `${firstSource}\nB --> C`;

    const first = await render(frame, { revision: 1, source: firstSource });
    const invalid = await render(frame, { revision: 2, source: "not a mermaid diagram" });
    const second = await render(frame, { revision: 3, source: secondSource });

    expect(first).toMatchObject({ type: "rendered", revision: 1, source: firstSource });
    expect(invalid).toEqual({ type: "renderError", revision: 2 });
    expect(second).toMatchObject({ type: "rendered", revision: 3, source: secondSource });
  });

  it("coalesces queued input and never reports an obsolete result", async () => {
    const frame = await mountRuntime();
    const obsoleteSource = `flowchart TD\n${Array.from({ length: 250 }, (_, index) => `A${index} --> A${index + 1}`).join("\n")}`;
    const currentSource = "flowchart TD\nCurrent --> Result";
    const obsoleteResponses: MermaidRuntimeMessage[] = [];
    function collect(event: MessageEvent): void {
      if (event.source !== frame.contentWindow) {
        return;
      }
      const message = parseMermaidRuntimeMessage(event.data);
      if (message && message.type !== "bridgeReady" && message.revision === 10) {
        obsoleteResponses.push(message);
      }
    }
    window.addEventListener("message", collect);
    frame.contentWindow?.postMessage(
      {
        type: "render",
        revision: 10,
        source: obsoleteSource,
        colorScheme: "dark",
        interactive: false,
      },
      "*",
    );
    const current = await render(frame, { revision: 11, source: currentSource });
    window.removeEventListener("message", collect);

    expect(current).toMatchObject({ type: "rendered", revision: 11, source: currentSource });
    expect(obsoleteResponses).toEqual([]);
  });

  it("draws labels dark on the light scheme and light on the dark scheme", async () => {
    const frame = await mountRuntime({ inspectable: true });
    const source = "flowchart TD\nA[Start] --> B[End]";

    await render(frame, { revision: 1, source, colorScheme: "light" });
    const lightSchemeLabel = labelBrightness(frame, "Start");
    await render(frame, { revision: 2, source, colorScheme: "dark" });
    const darkSchemeLabel = labelBrightness(frame, "Start");

    expect(lightSchemeLabel).toBeLessThan(0.3);
    expect(darkSchemeLabel).toBeGreaterThan(0.7);
  });

  it("draws no links or external images", async () => {
    const frame = await mountRuntime({ inspectable: true });
    const source = [
      "flowchart TD",
      'A[Go] --> B@{ img: "https://example.com/x.png", label: "Picture", w: 60, h: 60 }',
      'click A "https://example.com"',
    ].join("\n");

    const result = await render(frame, { revision: 1, source });

    expect(result).toMatchObject({ type: "rendered", revision: 1 });
    const svg = diagramSvg(frame);
    expect(svg.textContent).toContain("Go");
    expect(svg.querySelector("a, image")).toBeNull();
  });

  it("keeps pie percentages readable on every slice in both schemes", async () => {
    const frame = await mountRuntime({ inspectable: true });
    const source = ["pie", ...Array.from({ length: 8 }, (_, index) => `"S${index}" : 1`)].join(
      "\n",
    );

    for (const [revision, colorScheme] of [
      [1, "light"],
      [2, "dark"],
    ] as const) {
      await render(frame, { revision, source, colorScheme });
      const svg = diagramSvg(frame);
      const label = svg.querySelector(".pele-slice-labels text");
      if (!label) {
        throw new Error("Pie drew no slice labels");
      }
      const labelFill = computedFill(frame, label);
      const slices = Array.from(svg.querySelectorAll(".pele-slice"));
      expect(slices).toHaveLength(8);
      for (const slice of slices) {
        expect(contrastRatio(computedFill(frame, slice), labelFill)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
