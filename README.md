# herdr-pixel-office

A [herdr](https://herdr.dev) plugin that renders your AI coding agents as pixel-art characters working in a tiny top-down office.

<p align="center">
  <img src="docs/office.gif" width="704"
       alt="A pixel-art office: agents typing at desks under their live tool labels (Running: npm test, Reading screen.ts) with context and usage gauges, one with a raised hand and a bubble while it waits on you, then the view scrolls down to the break room where idle agents play table tennis, pool and foosball while a bartender works the counter.">
</p>

The room has two zones, and where a character *is* tells you what its agent is doing:

- **The desk bank** — agents that are working or blocked sit at a desk, typing, with the monitor glowing in their status color.
- **The break room** — agents with nothing to do head downstairs. They sit on the sofa, wander, stand around chatting, fetch a coffee from the machine, and pair off for table tennis or a game of pool.

When an agent's status changes it walks between the two. Start a turn and the character gets up from the sofa and walks to a desk; finish one and it wanders back. Desks are drawn whether or not anyone is at them, so the room reads as an office rather than a grid of agents.

Characters act out what the agent is actually doing — not just its coarse status. The plugin reads each agent's pane and pulls out the live tool call, so a character **types** while editing or running commands and **reads** while searching, with the tool shown under its desk (`Reading office.ts`, `Running: npm test`). Gauges under each desk track context and rate-limit usage. Idle characters get up and wander the common area, pathing around the furniture, then head back for a sit-down.

Inspired by [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) (VS Code), rebuilt as a native herdr pane in the spirit of [herdr-flock](https://github.com/ragamo/herdr-flock).

## Requirements

- [herdr](https://herdr.dev) 0.7.0 or newer — check with `herdr --version`

## Install

### From the herdr marketplace

```bash
herdr plugin install devangchhajed/herdr-pixel-office
```

## Start it

### From the command line

The same action, invoked by hand:

```bash
herdr plugin action invoke open --plugin pixel.office
```

Or open the pane yourself, if you want it somewhere other than a right-hand
split — `--placement` takes `split`, `tab`, `overlay` or `zoomed`:

```bash
herdr plugin pane open --plugin pixel.office --entrypoint office \
  --placement tab --focus
```

### A keybinding (the way you will actually use it)

Add this to `~/.config/herdr/config.toml`:

```toml
[[keys.command]]
key = "prefix+o"
type = "plugin_action"
command = "pixel.office.open"
description = "Open Pixel Office"
```

Then pick it up without restarting your session:

```bash
herdr config check            # catches a typo before it costs you a restart
herdr server reload-config
```

`prefix+o` now opens the office in a split to the right of whatever you are
working in.



## Using it

### Reading the room

The first thing to know is that **position is status** — you can tell what your
agents are doing without reading a word:

- Someone **at a desk** is working or blocked. Look here first.
- Someone **in the break room** is idle, done, or unknown. Nothing needs you.
- An **amber monitor and a raised hand** is an agent blocked on you — a `?`
  bubble for a question, `…` for a permission prompt. The bubble stays up until
  you deal with it, which is why blocked agents keep their desk instead of
  wandering off.
- A **green flickering monitor** is a live turn. The character types for
  write-ish tools and reads a held-up page for read-ish ones.
- A **checkmark that fades** is a turn that just finished.

Under each desk is the live tool call (`Reading office.ts`, `Running: npm test`)
and two gauges for context and rate-limit usage.

### Getting to an agent

Select a character with the arrow keys or a click, then press `Enter` to jump
your terminal to that agent's pane. Clicking an already-selected character does
the same thing in one gesture. That is the main loop: see an amber desk, press
Enter, deal with it.

If you are running more agents than fit on screen, `Tab` to the **Roster** — the
same agents as a table, sorted with anything blocked at the top.

### Keys

| Key | Effect |
|---|---|
| `Tab` | Next screen: Office → Roster → Settings |
| `↑` `↓` `←` `→` | Move the selection; the camera follows |
| `Enter` / `f` | Focus the selected agent's terminal (on Settings, edit the company name) |
| `Home` / `End` | Jump to the desks / the break room |
| `PgUp` / `PgDn` | Scroll half a screen |
| `n` | Name tags on or off |
| `t` | Break-room chatter (off by default) |
| `s` | Bell when an agent blocks |
| `c` | Wall clock |
| `r` | Water reminder |
| `w` | Pin the reminder on screen so you can see it without waiting for the hour |
| `q` | Quit |

### Mouse

| Action | Effect |
|---|---|
| Click a character | Select it |
| Click it again | Focus its terminal |
| Drag a character | Move it to another desk |
| Hover a character | Tooltip: status, activity, project, gauges |
| Scroll wheel | Scroll the room |
| Click a tab | Switch screen |
| Click the cat | It is pleased |

When people are off-screen a `▴ n  ▾ n` hint shows how many are above and below.

### Settings

The third screen, reached with `Tab`. Set a **company name** and it appears on
the wall header: press `Enter` to edit, `Enter` again to save, `Esc` to cancel,
`Backspace` to correct. The field caps at 28 characters. While it is open every
keystroke goes to it, so a name containing `q` will not quit the office.

The screen also lists every toggle above with its current state, so it doubles
as the reference for what the letters do.

Settings, desk assignments and the company name are saved and restored; the
screen you were on is not, so the office always opens on the office.

## The wall header

One band across the top of the office: the **company name** on a plaque to the
right of the doorway, a **seven-segment clock** at the right showing 12-hour time
with the day and date under it, and — for the first two minutes of every hour —
a flashing **DRINK WATER** reminder between them. `c` hides the clock, `r`
switches the reminder off, and `w` pins it on screen so you can see what it looks
like without waiting for the hour.

On a narrow pane they lay out by priority: the clock keeps its place, the
reminder takes the next claim on the space, and the company plaque is dropped
first rather than anything overlapping.

## The break room

Everything idle agents do down there is cosmetic — a social activity never changes what an agent is doing, and the moment its status goes back to `working` or `blocked` it drops whatever it was holding and walks back to a desk.

- **Chatting** — two agents pair off, walk over to each other and turn to face one another. They do it quietly: speech bubbles popping up across the room pull your eye away from the desks, so the lines are off by default. Press `t` if you want to hear them.
- **Table tennis** — two agents take opposite ends, hold paddles, and rally a ball that arcs over the net.
- **Pool** — two agents line up with cues at a felt table with pockets and balls.
- **Foosball** — two agents take the handles of a table with four rods of red and blue figures.
- **Coffee** — an agent walks to the machine, waits for it, and keeps the cup afterwards.
- **A drink** — an agent goes to the cocktail counter, where a bartender is always on duty, waits while it is made, and keeps the glass.
- **Sitting down** — a communal table with chairs, for drinks and lunch.

The furniture (sofa, coffee table, coffee machine, bench, table-tennis table, pool table, foosball table, cocktail counter, dining table) flows left to right and wraps to a new row when the pane is too narrow, so every pane gets the whole break room — a narrow one just gets a taller one.

`Home` jumps to the desks, `End` to the break room. When people are off-screen, a `▴ n  ▾ n` hint shows how many are above and below.

## The room

Desk rows are added only as agents need them, so the break room stays as close to the desks as it can.

## Screens

**Office** — the room itself.

**Roster** — the same agents as a table: status, name, agent, workspace and
project, sorted so anything blocked is at the top.

**Settings** — the company name and every toggle, with its current state.

## Agent status → character

| herdr `agent_status` | Where | Character | Monitor |
|---|---|---|---|
| `working` + write-ish tool | Desk | Types, hands alternating | Green, gently flickering |
| `working` + read-ish tool | Desk | Reads a page held up | Green, gently flickering |
| `blocked` (permission) | Desk | Hand up, `…` bubble that stays until resolved | Amber |
| `blocked` (a question) | Desk | Hand up, `?` bubble that stays until resolved | Amber |
| `done` | Common area | Walks off with a checkmark bubble that fades | — |
| `idle` | Common area | Sits, and wanders between sits | — |
| `unknown` | Common area | Sits still | — |

Blocked agents stay at their desk on purpose: they are the ones waiting on you, so they should be where you look for them, not in the lounge.

Read-ish tools are `Read`, `Grep`, `Glob`, `WebFetch` and `WebSearch`; everything else types. The split and the label wording match pixel-agents' provider for the same agent CLI.

Sub-agents appear as small figures beside their parent's monitor while they run. Named herdr agents (teammates) get a `▸` badge and take the front desks of their area.

Each agent's appearance (skin tone, hair, shirt, trousers) is derived from its pane id, so the same session always looks the same.

## Areas

Desks are grouped into bands, one per herdr workspace, tinted and labelled with the project name and workspace id (`api w4`, `web w6`) along the top edge — the equivalent of pixel-agents' Areas, which map folders to regions of the office. An agent keeps its desk as long as its own area is not resized.

## How it talks to herdr

The socket is resolved the way herdr itself resolves it: `$HERDR_SOCKET_PATH`, then `~/.config/herdr/herdr.sock`, then `herdr status server --json`.

Two polls run over that socket:

- `agent.list` once a second — the roster, statuses and workspaces. herdr's event subscriptions are per-pane, which would mean re-subscribing every time a pane appears; for a view that repaints at 12fps a poll is both simpler and always complete.
- `agent.read` for one pane per 250ms, round-robin with working agents first — the pane text that the tool, activity label, gauges and sub-agent count are parsed out of. Pane reads are much heavier than `agent.list`, so the rate is bounded rather than fanned out.

`agent.focus` is called with the selected character's `pane_id` when you press Enter.

herdr reports only a coarse `agent_status`, so everything finer is scraped. The patterns that split `blocked` into *permission* versus *question*, and the background sub-agent count, are taken from herdr's own detection rules (visible via `herdr agent explain`).

## What it reads, and what it doesn't

Worth knowing before you install anything that watches your terminals:

- It calls `agent.read` on your herdr panes, which returns **the visible text of
  those panes** — your prompts, the agent's output, file paths, commands. That is
  how the activity label, the reading-vs-typing animation and the gauges work.
  Only the last ~30 visible lines are requested, and only the derived fields
  (tool name, a truncated label, two percentages, a sub-agent count) are kept.
- It makes **no network connections at all.** The only socket it opens is the
  local herdr Unix socket, and the only process it spawns is `herdr status
  server --json`, to find that socket when the env var is absent. There is no
  telemetry, no analytics, no remote anything, and zero runtime dependencies
  that could add some — `dependencies` in `package.json` is empty and stays that
  way.
- It writes exactly one file: the state below.
- The one thing it does *to* your session is `agent.focus`, when you press Enter
  or click a selected character.

If you would rather it not read pane contents, the office still works without
the scraper — you lose the activity labels, the reading pose and the gauges, but
statuses, zones, wandering and focus all come from `agent.list`.

## State

Saved to `office.json`: desk and break-room assignments, the company name, and
the name-tag, chatter, bell, clock and water-reminder toggles. The screen you
were last on is deliberately **not** saved — the office always opens on the
office.

The file lives in `$HERDR_PLUGIN_STATE_DIR` when herdr launches the pane, and
falls back to the per-user state directory when you run it yourself:

```
~/Library/Application Support/herdr-pixel-office/office.json   # macOS
${XDG_STATE_HOME:-~/.local/state}/herdr-pixel-office/office.json   # Linux
```

## Uninstall

```bash
herdr plugin uninstall pixel.office   # installed from the marketplace
herdr plugin unlink pixel.office      # linked from a local checkout
```

To also drop the saved desk layout:

```bash
rm -rf ~/Library/Application\ Support/herdr-pixel-office   # macOS
rm -rf ~/.local/state/herdr-pixel-office                   # Linux
```

## Tech

- **Node + TypeScript**, no runtime dependencies
- BFS pathfinding over a 4px collision grid, so characters route around desks and sofas
- Rendering is a hand-rolled pixel framebuffer: one terminal cell carries two pixels via the `▀` half-block, and frames are diffed so a repaint only writes the cells that changed
- **Platforms** — Linux, macOS
