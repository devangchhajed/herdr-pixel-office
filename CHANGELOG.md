# Changelog

## 0.1.0

First release.

- Top-down pixel-art office rendered in the terminal, one character per herdr agent.
- Two zones: agents that are working or blocked sit at a desk, everyone else goes
  to the common area and wanders between sofa, bench and coffee machine.
- Activity from the live tool call, scraped from the pane: reading vs typing
  animation, and a label under the desk (`Reading office.ts`, `Running: npm test`).
- Context and rate-limit gauges under each desk, and as a Roster column.
- Speech bubbles: `…` for a permission request, `?` for a question, a fading
  checkmark when a turn ends.
- Desks grouped into tinted areas, one per herdr workspace.
- Sub-agents shown as small figures beside their parent.
- BFS pathfinding around furniture, hover tooltips, drag to reseat, an office cat,
  an optional bell when an agent blocks, and persisted desk assignments.
- Roster screen sorted so anything blocked is at the top.
- Demo mode when no herdr server is reachable.
