# Can the Pele swap ship as a Paseo plugin?

Question from the USER (2026-11-19): can the Mermaid-to-Pele swap be a Paseo plugin instead of a change to core app code?

Answer: no, not with today's plugin API.

## Findings

| #   | Finding                                                                                                                                                                                                                                                                                                                               | Evidence                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Our base branch has no plugin system. `fork/dev` is upstream `main` as of 2026-08-12 plus one commit. The plugin system landed upstream after that; upstream `main` is 1,814 commits ahead.                                                                                                                                           | `git ls-tree -d fork/dev packages/` has no `packages/plugin`; `git rev-list --count fork/dev..origin/main` = 1814              |
| 2   | Upstream's plugin API has no hook that replaces how a Markdown code fence or diagram renders. Plugins can add file panels, timeline rows, sidebar items, composer items, buttons, themes, providers, settings and workspace panels.                                                                                                   | `origin/main:docs/plugins.md` section list; `origin/main:public-docs/plugins/reference.md`                                     |
| 3   | The fence-to-renderer map is a fixed object in the app.                                                                                                                                                                                                                                                                               | `packages/app/src/components/markdown/fence/index.tsx:11` (`diagramFences = { mermaid: MermaidFence }`)                        |
| 4   | The Markdown component that plugins get draws diagrams with the built-in Mermaid runtime.                                                                                                                                                                                                                                             | `origin/main:public-docs/plugins/reference.md:1029` ("The host supplies theme, text selection, code blocks, tables, diagrams") |
| 5   | Plugin client code may import only `react`, `react-native`, `zod`, `@tanstack/react-query` and the plugin SDK. `react-native-svg`, WebViews and DOM APIs are off limits. Pele returns an SVG string, and React Native's `Image` does not draw SVG on iOS or Android, so a plugin has no supported way to show the diagram on a phone. | `origin/main:public-docs/plugins/reference.md:240-277`                                                                         |
| 6   | `DocumentFrame` only shows a local file URL (`blob:` on web, `file:` on native) from a file panel's handle, not an SVG string built in memory.                                                                                                                                                                                        | `origin/main:public-docs/plugins/reference.md:1809,1904`                                                                       |
| 7   | A plugin cannot remove Mermaid from the app. Mermaid's 3.5 MB runtime stays in the bundle and Pele is added next to it.                                                                                                                                                                                                               | `runtime/html.gen.ts` is committed app code                                                                                    |

## The closest workaround and why it falls short

1. Rebase the fork onto upstream `main` (1,814 commits).
2. Add a timeline transformer that claims every assistant message with a ` ```mermaid ` fence, splits the text, and renders the prose plus Pele diagrams itself.
3. Add a file panel that replaces the built-in Markdown preview for `.md` files.

This duplicates Paseo's Markdown rendering in two places. It still cannot draw the SVG on iOS or Android (finding 5), and Mermaid stays in the bundle (finding 7).

## Paths that work

- **Core swap (current plan).** Changes the runtime entry, the build script and one dependency. Hosts, messages, source policy and tests stay the same. Works on web, desktop, iOS and Android.
- **Upstream plugin hook first.** Propose a "fence renderer" contribution to upstream Paseo, then ship Pele as a plugin. Needs maintainer buy-in, a rebase onto upstream `main`, and a plugin-safe way to draw SVG on native. Much larger and not under our control.
