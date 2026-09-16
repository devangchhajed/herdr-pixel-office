import { AgentSnapshot, AgentStatus } from "./herdr";

// Deliberately generic: demo mode is what people screenshot, so nothing here
// should look like anyone's real project or workstream.
const DEMO_AGENTS: { label: string; cwd: string; agent: string }[] = [
  { label: "Fix the failing test", cwd: "/work/api", agent: "agent-a" },
  { label: "Add a retry to the fetch", cwd: "/work/api", agent: "agent-a" },
  { label: "Rename a helper", cwd: "/work/web", agent: "agent-a" },
  { label: "Update the changelog", cwd: "/work/web", agent: "agent-b" },
  { label: "Tidy the imports", cwd: "/work/docs", agent: "agent-a" },
  { label: "Bump a dependency", cwd: "/work/docs", agent: "agent-c" },
  { label: "Write the README", cwd: "/work/tools", agent: "agent-a" },
];

const CYCLE: AgentStatus[] = ["working", "working", "blocked", "working", "done", "idle"];

/**
 * Demo mode: stands in for herdr when no socket is reachable, so the office can
 * be explored (and the rendering worked on) without a server running.
 */
export class MockHerdr {
  private tick = 0;

  agents(): AgentSnapshot[] {
    this.tick++;
    return DEMO_AGENTS.map((demo, i) => {
      // Each agent walks the status cycle at its own pace.
      const phase = Math.floor(this.tick / (24 + i * 9) + i) % CYCLE.length;
      return {
        paneId: `demo:p${i}`,
        terminalId: `demo_term_${i}`,
        workspaceId: `w${1 + (i % 3)}`,
        tabId: `demo:t${i}`,
        agent: demo.agent,
        name: null,
        label: demo.label,
        status: CYCLE[phase],
        cwd: demo.cwd,
        focused: false,
      };
    });
  }
}
