# Mermaid renderer swap: Mermaid.js to Pele

Work item W381. Replace the `mermaid` npm package with [Pele](https://github.com/obsidianmd/pele) (MIT, v1.13.0) as the renderer behind Mermaid code fences in the app.

## Approach: swap the renderer inside the runtime page

The app renders diagrams in one bundled runtime page. `build-runtime.mjs` bundles `runtime/entry.ts` into `runtime/html.gen.ts`. Web loads that page in a sandboxed iframe (`host.web.tsx`), and native loads it in a WebView (`host.native.tsx`). Both hosts talk to it through the same messages (`render`, `rendered`, `renderError`, `bridgeReady`). `entry.ts` is the only file that imports `mermaid`.

Swap Pele in at `entry.ts` and leave both hosts, the message protocol, the render model, and the request driver unchanged. One change covers web and native, and the security boundary stays the same: sandboxed iframe, WebView navigation block, and a `default-src 'none'` content policy.

Considered and not taken:

| Option                                                                  | Why not now                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Drop the iframe on web and insert Pele's SVG straight into the app page | It moves untrusted diagram markup out of the sandbox into the app document, which is a security-posture change, and it makes web and native take different paths. Native still needs a WebView, because React Native has no DOM and `react-native-svg` can't resolve Pele's CSS variables. |
| Use `mount()` instead of `render()`                                     | `mount()` brings its own zoom, resize and error UI. The web host already owns zoom and pan, and the hosts measure the SVG themselves. `render()` keeps the change to one function call.                                                                                                    |
| Load diagram types lazily (`pele/lazy`)                                 | The full bundle is already about a fifth of Mermaid's size, and the CSP blocks fetching chunks into the runtime page anyway.                                                                                                                                                               |

## Diagram types

A spike rendered sample sources through Pele 1.13.0 in Node. It took each diagram keyword from the detectors in `node_modules/mermaid` 11.16.0.

| Result                                                | Types                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Recognized by Pele (38 of 38 Mermaid 11.16 built-ins) | flowchart/graph, flowchart-elk, sequence, class, state, ER, journey, gantt, pie, quadrant, xychart, requirement, gitGraph, C4 (all five), mindmap, timeline, kanban, sankey, packet, radar, block, treeView, architecture, eventmodeling, ishikawa, venn, treemap, wardley, cynefin, railroad (all four), swimlane, info |
| Not recognized                                        | `zenuml`, an external Mermaid plugin that the app never installed. It falls back to the source block as before.                                                                                                                                                                                                          |

Known differences from Mermaid.js:

- Pele uses its own layout and visual style. Diagrams look different but carry the same content. `flowchart-elk` uses Pele's layout instead of ELK.
- `<i>` and `<br>` in labels render as italic text and line breaks. The e2e fixture `Done["<i>Done</i>"]` still shows "Done".
- `fa:fa-car` icons render as label text only, because no icon set is supplied. With `htmlLabels: false`, Mermaid didn't load Font Awesome either.
- `$$...$$` math shows the TeX source, because no typesetter is supplied.
- A 250-edge flowchart renders in about 6 ms in Node, compared with Mermaid's asynchronous render.

## Theming

Pele colors everything through `--pele-*` CSS variables and defaults to a light palette. It has no built-in dark theme. Before each render, `entry.ts` sets the variables on the page root from the render message's `colorScheme`, using a palette built from the app's default theme tokens (`packages/app/src/styles/theme.ts`):

| Pele variable                                                                  | Light                         | Dark (default Paseo tint)                   |
| ------------------------------------------------------------------------------ | ----------------------------- | ------------------------------------------- |
| `--pele-bg` (edge-label backing, matches the code-block background `surface2`) | `#f4f4f5`                     | `#272A29`                                   |
| `--pele-fg`                                                                    | `#1a1a1e`                     | `#fafafa`                                   |
| `--pele-muted`                                                                 | `#71717a`                     | `#A1A5A4`                                   |
| `--pele-surface` (node fill)                                                   | `#ffffff`                     | `#181B1A`                                   |
| `--pele-surface-alt` (subgraph fill)                                           | `#fafafa`                     | `#1E2120`                                   |
| `--pele-line` (edges)                                                          | `#52525b` (zinc 600)          | `#A1A5A4`                                   |
| `--pele-border` (node outline)                                                 | `#a1a1aa` (zinc 400)          | `#595B5B` (surface4)                        |
| `--pele-accent`                                                                | `#20744A`                     | `#7ccba0`                                   |
| `--pele-series-1` to `-8` (chart fills)                                        | Pele's default hues, darkened | Pele's default hues, lightened where needed |

Pie percentages draw in `--pele-bg` on the slice fill, so every series color keeps at least 4.5:1 contrast with `--pele-bg`. With Pele's default orange, a light-scheme label reaches only 2.3:1. `runtime.browser.test.ts` checks every slice on both schemes.

The theme is fixed per color scheme, as before. Mermaid's `dark` and `default` themes didn't follow the app's dark tints either. Matching every tint exactly would mean sending theme colors through a new runtime message. That isn't needed to replace the renderer, so the swap doesn't do it. Pele measures labels with canvas, so the runtime passes the same font stack to `render({ fontFamily })` and to `--pele-font`. The CSP blocks web fonts, so the stack is system fonts only.

## Errors

`render()` throws `PeleError` with a `code` (`unsupported-diagram`, `syntax`, `semantic`, `limit`), a `line`, a `column` and a message. The runtime catches every error and sends `renderError`, as it does today. The render model then keeps the last good preview while the message streams, and shows the highlighted source block once the message is complete (`render-model.ts:122`).

Today the user sees no reason a diagram failed. Whether to show Pele's error line under the source block is a USER decision, tracked as an open ask (see [Open decision](#Open%20decision)).

## Security

- Render options: `links: false` and `images: false`. Pele otherwise emits `<a href>` for `click` statements and `<image href="https://…">` for image shapes. The CSP already blocks image loads, and the iframe sandbox and WebView navigation guard already block link clicks. These options keep the network-free result independent of those layers.
- `idPrefix` is `paseo-mermaid-<revision>`, as before.
- `source-policy.ts` (the up-front denylist for `@{`, `url(`, raw tags, entity escapes) stays unchanged. Its comment cites Mermaid's fetch-during-render behavior, which Pele lacks. Relaxing the denylist to allow `@{ shape: … }` is a separate decision.
- The CSP in the runtime page is unchanged, and `runtime-html.test.ts` still pins it.

## Browser support floor

The app supports iOS 15.1. esbuild transforms syntax, not runtime APIs. A scan of `pele/dist/pele.js` found no `structuredClone`, `Array.prototype.at`, `Object.hasOwn`, `findLast`, regex lookbehind or `Intl.Segmenter`. `OffscreenCanvas` (iOS 16.4) is feature-checked, with a fallback to a `<canvas>` element. The `structuredClone` polyfill banner in `build-runtime.mjs` existed only for Mermaid, so it goes.

Pele draws the halo behind a subgraph title with `color-mix()`, which arrived in iOS 16.2. On older WebKit the stroke is dropped and edges cross the title. The runtime page's stylesheet sets a plain `--pele-bg` halo inside `@supports not (color: color-mix(...))`. No test browser lacks `color-mix()`, so this fallback has no automated test and hasn't been checked on an iOS 15 device.

## Bundle size

| Artifact                                                        | Before (Mermaid 11.16) | After (Pele 1.13)             |
| --------------------------------------------------------------- | ---------------------- | ----------------------------- |
| `runtime/html.gen.ts`, shipped in the web and native JS bundles | 3,578,201 bytes        | 739,764 bytes (about a fifth) |

## Units

Each unit runs test-writer, then implementer, then reviewer.

1. **Core swap.** `entry.ts` calls Pele `render()` with the options above and sets the scheme palette. Pele renders synchronously, so the runtime's queue drops its in-flight guard and stale-result check: every message that arrives before the scheduled drain coalesces into the newest one. `build-runtime.mjs` drops the banner. `packages/app/package.json` and `package-lock.json` replace `mermaid` with `pele`. Regenerate `html.gen.ts`. Tests in `runtime.browser.test.ts`: the dark and light schemes produce light and dark label text, and the output for a diagram with a `click` link and an image shape contains no `<a>` or `<image>`. The existing streaming, invalid and coalescing tests still pass.
2. **Error display.** Depends on the open decision.
3. **Verification on web.** Run the app on web. Take screenshots of a Mermaid fence in chat, in the Markdown file preview, and with an invalid diagram. Save them in `evidence/sources/`. Run `npm run typecheck`, `npm run lint`, the fence unit tests, the runtime browser tests, and `e2e/browser/mermaid-streaming.spec.ts`.
4. **Land.** Use the `merge` skill: commit, `git fetch fork && git merge fork/dev`, push the branch to `fork`, and open a PR against `dev`.

## Open decision

Should an invalid diagram show why it failed under the source block after the message completes? The choice is parked as a USER ask. Unit 1 doesn't depend on it.

What Pele 1.13.0 throws for sample invalid sources (`/tmp/pele-inspect/errs.mjs`):

| Source                         | `code`                | `line`:`column` | First line of `message`                                                                   |
| ------------------------------ | --------------------- | --------------- | ----------------------------------------------------------------------------------------- |
| `flowchart TD` / `A --> `      | `syntax`              | 2:8             | `Parse error on line 2:` then the line, a caret, and `Expecting 'NODE_STRING', got 'EOF'` |
| `sequenceDiagram` / `Alice->>` | `syntax`              | 2:11            | `Parse error on line 2:` then `Expecting 'ACTOR', got 'NEWLINE'`                          |
| `pie` / `"a" : x`              | `syntax`              | 2:9             | `Lexical error on line 2. Unrecognized text.`                                             |
| `notadiagram` / `foo`          | `unsupported-diagram` | 0:0             | `No diagram type detected for the given text.`                                            |

The full message is English parser output with grammar token names. The `code`, `line` and `column` fields are enough to build a short translated note.
