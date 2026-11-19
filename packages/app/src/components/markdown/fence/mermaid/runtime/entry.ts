import { render as renderDiagram } from "pele";
import {
  parseMermaidRuntimeRenderMessage,
  type MermaidRuntimeMessage,
  type MermaidRuntimeRenderMessage,
} from "./messages";
import type { DiagramColorScheme } from "../render-model";

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage?: (data: string) => void;
    };
    __PASEO_MERMAID_RUNTIME_RECEIVE__?: (message: unknown) => void;
  }
}

function sendToHost(message: MermaidRuntimeMessage): void {
  window.ReactNativeWebView?.postMessage?.(JSON.stringify(message));
  if (window.parent !== window) {
    window.parent.postMessage(message, "*");
  }
}

// The app's default web font stacks (`DEFAULT_UI_FONT_STACK` and
// `DEFAULT_MONO_FONT_STACK` in src/styles/theme.ts). Pele measures labels with
// the fonts passed to render(), and draws them with --pele-font, so both match.
const FONT_FAMILY =
  "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_FAMILY_MONO =
  "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

// Pele draws every color from these variables. Values come from the light
// theme and the default dark tint in src/styles/theme.ts. `--pele-bg` backs
// edge labels, so it matches the code block background (surface2).
// Chart labels (pie percentages) draw in `--pele-bg` on series fills, so each
// series color keeps 4.5:1 contrast with `--pele-bg`. The hues are Pele's
// defaults with OKLCH lightness moved until they reach that ratio.
const PALETTES: Record<DiagramColorScheme, Record<string, string>> = {
  light: {
    "--pele-bg": "#f4f4f5",
    "--pele-fg": "#1a1a1e",
    "--pele-muted": "#71717a",
    "--pele-line": "#52525b",
    "--pele-surface": "#ffffff",
    "--pele-surface-alt": "#fafafa",
    "--pele-border": "#a1a1aa",
    "--pele-accent": "#20744A",
    "--pele-series-1": "#4671a1",
    "--pele-series-2": "#a9590a",
    "--pele-series-3": "#2f7e27",
    "--pele-series-4": "#c73b3e",
    "--pele-series-5": "#337975",
    "--pele-series-6": "#836c06",
    "--pele-series-7": "#935c84",
    "--pele-series-8": "#8d664e",
  },
  dark: {
    "--pele-bg": "#272A29",
    "--pele-fg": "#fafafa",
    "--pele-muted": "#A1A5A4",
    "--pele-line": "#A1A5A4",
    "--pele-surface": "#181B1A",
    "--pele-surface-alt": "#1E2120",
    "--pele-border": "#595B5B",
    "--pele-accent": "#7ccba0",
    "--pele-series-1": "#6895c7",
    "--pele-series-2": "#f58518",
    "--pele-series-3": "#55a34c",
    "--pele-series-4": "#f16361",
    "--pele-series-5": "#72b7b2",
    "--pele-series-6": "#eeca3b",
    "--pele-series-7": "#b980a9",
    "--pele-series-8": "#b28970",
  },
};

function applyTheme(colorScheme: DiagramColorScheme): void {
  const { style } = document.documentElement;
  style.setProperty("--pele-font", FONT_FAMILY);
  style.setProperty("--pele-font-mono", FONT_FAMILY_MONO);
  for (const [name, value] of Object.entries(PALETTES[colorScheme])) {
    style.setProperty(name, value);
  }
}

function setViewport(interactive: boolean): void {
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute(
      "content",
      interactive
        ? "width=device-width, initial-scale=1, maximum-scale=8"
        : "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
    );
}

let pendingRender: MermaidRuntimeRenderMessage | null = null;

function render(message: MermaidRuntimeRenderMessage): void {
  try {
    const { svg } = renderDiagram(message.source, {
      idPrefix: `paseo-mermaid-${message.revision}`,
      fontFamily: FONT_FAMILY,
      fontFamilyMono: FONT_FAMILY_MONO,
      links: false,
      images: false,
    });
    setViewport(message.interactive);
    const host = document.getElementById("diagram");
    if (!host) {
      return;
    }
    applyTheme(message.colorScheme);
    host.innerHTML = svg;
    const rect = host.querySelector("svg")?.getBoundingClientRect();
    sendToHost({
      type: "rendered",
      revision: message.revision,
      source: message.source,
      colorScheme: message.colorScheme,
      height: Math.ceil(rect?.height ?? host.scrollHeight),
      width: Math.ceil(rect?.width ?? host.scrollWidth),
    });
  } catch {
    sendToHost({ type: "renderError", revision: message.revision });
  }
}

function drainRenderQueue(): void {
  const next = pendingRender;
  pendingRender = null;
  if (next) {
    render(next);
  }
}

function receiveRender(value: unknown): void {
  const message = parseMermaidRuntimeRenderMessage(value);
  if (!message) {
    return;
  }
  // Pele renders synchronously, so every message that arrives before the
  // scheduled drain coalesces into the newest one, and no result goes stale.
  const isDrainScheduled = pendingRender !== null;
  pendingRender = message;
  if (!isDrainScheduled) {
    window.setTimeout(drainRenderQueue, 0);
  }
}

window.__PASEO_MERMAID_RUNTIME_RECEIVE__ = receiveRender;
window.addEventListener("message", (event) => {
  if (event.source === window.parent) {
    receiveRender(event.data);
  }
});

sendToHost({ type: "bridgeReady" });
