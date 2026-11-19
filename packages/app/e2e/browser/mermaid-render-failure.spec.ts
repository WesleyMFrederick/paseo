import { expect, test } from "../support/fixtures";
import { requestDiagram, waitForDiagramTurnToComplete } from "../support/helpers/diagram";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

const BROKEN_MERMAID = [
  "```mermaid",
  "flowchart LR",
  "  Start --> Middle",
  "  Middle -->",
  "```",
].join("\n");

test("shows the failing line under a Mermaid diagram that can't be drawn", async ({
  context,
  page,
}) => {
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "mermaid-failure-",
    title: "Broken Mermaid",
    featureValues: {
      mockStreamingAssistantResponse: BROKEN_MERMAID,
      mockStreamingAssistantIntervalMs: 50,
    },
  });
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openAgentRoute(page, agent);
    await requestDiagram(agent);
    await waitForDiagramTurnToComplete(agent);

    await expect(page.getByText("Unable to draw diagram (line 3)")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Middle -->", { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("img", { name: "Diagram" })).toHaveCount(0);

    // The note is app chrome, so copying the message must leave it out.
    await page
      .getByTestId("assistant-message")
      .filter({ hasText: "Middle -->" })
      .evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      });
    await page.keyboard.press("ControlOrMeta+c");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("Middle -->");
    expect(copied).not.toContain("Unable to draw diagram");
  } finally {
    await agent.cleanup();
  }
});
