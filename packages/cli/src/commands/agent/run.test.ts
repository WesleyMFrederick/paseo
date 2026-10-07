import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveExistingRunWorkspace,
  resolveRunCallerAgentId,
  runRunCommand,
  type AgentRunOptions,
} from "./run";

const createAgent = vi.fn();
const waitForFinish = vi.fn();
const daemonFetchWorkspaces = vi.fn();
const sendMessage = vi.fn();
const close = vi.fn();

vi.mock("../../utils/client.js", () => ({
  connectToDaemon: vi.fn(async () => ({
    createAgent,
    waitForFinish,
    fetchWorkspaces: daemonFetchWorkspaces,
    sendMessage,
    close,
  })),
  getDaemonHost: vi.fn(() => "ws://127.0.0.1:6767"),
}));

describe("managed agent caller context", () => {
  it("propagates a trimmed PASEO_AGENT_ID", () => {
    expect(resolveRunCallerAgentId({ PASEO_AGENT_ID: "  parent-agent  " })).toBe("parent-agent");
  });

  it("omits blank caller ids", () => {
    expect(resolveRunCallerAgentId({ PASEO_AGENT_ID: "   " })).toBeUndefined();
  });
});

describe("existing run workspace resolution", () => {
  it("queries the daemon for an exact workspace id and uses its directory", async () => {
    const fetchWorkspaces = vi.fn().mockResolvedValue({
      entries: [{ id: "workspace-2", workspaceDirectory: "/workspace/two" }],
      pageInfo: { nextCursor: null },
    });

    await expect(resolveExistingRunWorkspace({ fetchWorkspaces }, "workspace-2")).resolves.toEqual({
      id: "workspace-2",
      cwd: "/workspace/two",
    });
    expect(fetchWorkspaces).toHaveBeenCalledWith({
      filter: { query: "workspace-2" },
      page: { limit: 200 },
    });
  });

  it("rejects a workspace id absent from daemon state", async () => {
    const fetchWorkspaces = vi.fn().mockResolvedValue({
      entries: [],
      pageInfo: { nextCursor: null },
    });

    await expect(resolveExistingRunWorkspace({ fetchWorkspaces }, "missing")).rejects.toMatchObject(
      {
        code: "WORKSPACE_NOT_FOUND",
        message: "Workspace not found: missing",
      },
    );
  });
});

// validateRunOptions runs before the CLI ever connects to a daemon, so these
// invalid combinations reject without one running.
describe("runRunCommand option validation", () => {
  const originalWorkspaceId = process.env.PASEO_WORKSPACE_ID;

  beforeEach(() => {
    delete process.env.PASEO_WORKSPACE_ID;
  });

  afterEach(() => {
    if (originalWorkspaceId === undefined) {
      delete process.env.PASEO_WORKSPACE_ID;
    } else {
      process.env.PASEO_WORKSPACE_ID = originalWorkspaceId;
    }
  });

  async function expectInvalidOptions(options: AgentRunOptions, messageMatch: RegExp) {
    await expect(runRunCommand("do something", options, {} as never)).rejects.toMatchObject({
      code: "INVALID_OPTIONS",
      message: expect.stringMatching(messageMatch),
    });
  }

  it("rejects --new-workspace combined with --workspace", async () => {
    await expectInvalidOptions(
      { newWorkspace: "worktree", workspace: "ws-1" },
      /--new-workspace and --workspace cannot be combined/,
    );
  });

  it("allows explicit worktree workspace creation through validation", async () => {
    // Explicit workspace creation with no --workspace
    // must clear validation. It still fails later (provider resolution), which
    // is enough to prove the new guard did not reject it.
    await expect(
      runRunCommand("do something", { newWorkspace: "worktree", provider: undefined }, {} as never),
    ).rejects.not.toMatchObject({ code: "INVALID_OPTIONS" });
  });

  it("rejects unknown new workspace kinds", async () => {
    await expectInvalidOptions({ newWorkspace: "container" }, /Unsupported new workspace kind/);
  });

  it("rejects two workspace creation flags", async () => {
    await expectInvalidOptions(
      { newWorkspace: "local", worktree: "legacy-slug" },
      /--new-workspace and --worktree cannot be combined/,
    );
  });

  it("rejects an unknown worktree creation mode before connecting", async () => {
    await expectInvalidOptions(
      { newWorkspace: "worktree", worktreeMode: "container" },
      /Unsupported worktree mode/,
    );
  });
});

describe("run --agent forwarding", () => {
  const snapshot = {
    id: "agent-1",
    status: "running",
    provider: "omp",
    cwd: "/repo",
    title: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    daemonFetchWorkspaces.mockResolvedValue({
      entries: [{ id: "ws-1", workspaceDirectory: "/repo" }],
      pageInfo: { nextCursor: null },
    });
    createAgent.mockResolvedValue(snapshot);
    close.mockResolvedValue(undefined);
  });

  function lastCreateAgentRequest(): Record<string, unknown> {
    return createAgent.mock.calls.at(-1)?.[0] as Record<string, unknown>;
  }

  it("sends the agent name as a provider option and leaves the model alone", async () => {
    await runRunCommand(
      "do something",
      { provider: "omp", agent: "scout", workspace: "ws-1", background: true },
      {} as never,
    );

    const request = lastCreateAgentRequest();
    expect(request.providerOptions).toEqual({ agent: "scout" });
    expect(request.model).toBeUndefined();
    // The name is provider-native state, so it must not become a top-level
    // create-agent field.
    expect(request).not.toHaveProperty("agent");
  });

  it("keeps the model selection independent of the agent selection", async () => {
    await runRunCommand(
      "do something",
      { provider: "omp", model: "gpt-5.4", agent: "scout", workspace: "ws-1", background: true },
      {} as never,
    );

    const request = lastCreateAgentRequest();
    expect(request.model).toBe("gpt-5.4");
    expect(request.providerOptions).toEqual({ agent: "scout" });
  });

  it("omits provider options when no agent is requested", async () => {
    await runRunCommand(
      "do something",
      { provider: "omp", workspace: "ws-1", background: true },
      {} as never,
    );

    expect(lastCreateAgentRequest()).not.toHaveProperty("providerOptions");
  });

  it("forwards the agent name on the structured-output path", async () => {
    waitForFinish.mockResolvedValue({
      status: "idle",
      lastMessage: '{"answer":"ok"}',
      final: snapshot,
    });

    await runRunCommand(
      "do something",
      {
        provider: "omp",
        agent: "scout",
        workspace: "ws-1",
        outputSchema: '{"type":"object","properties":{"answer":{"type":"string"}}}',
      },
      {} as never,
    );

    expect(lastCreateAgentRequest().providerOptions).toEqual({ agent: "scout" });
  });

  it("rejects a blank agent name before connecting", async () => {
    await expect(
      runRunCommand("do something", { provider: "omp", agent: "   " }, {} as never),
    ).rejects.toMatchObject({
      code: "INVALID_AGENT_OPTION",
      message: "--agent cannot be empty",
    });
    expect(createAgent).not.toHaveBeenCalled();
  });
});
