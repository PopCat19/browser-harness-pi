# Browser Harness Pi ♞

Pi-coding-agent extension for direct browser control via CDP. Connect pi to your real browser — no bash CLI intermediary.

```
pi (TypeScript) → Unix socket → Python daemon → CDP WebSocket → Chrome
```

**13 custom tools** registered as a pi extension. The LLM controls your browser directly.

## Tools

| Tool | Purpose |
|------|---------|
| `browser_navigate` | New tab + goto URL |
| `browser_screenshot` | Capture viewport PNG |
| `browser_click` | Compositor-level mouse click (x, y) |
| `browser_type` | Insert text at focus |
| `browser_press_key` | Keypress with modifier bitmask |
| `browser_scroll` | Mouse wheel scroll |
| `browser_js` | Evaluate JS in page |
| `browser_page_info` | `{url, title, viewport, scroll}` |
| `browser_list_tabs` | List browser tabs |
| `browser_switch_tab` | Switch agent to tab |
| `browser_wait` | Sleep N seconds |
| `browser_wait_for_load` | Poll `document.readyState` |
| `browser_restart_daemon` | LLM self-heal |

## Install

```bash
# Clone
git clone https://github.com/PopCat19/browser-harness-pi
cd browser-harness-pi

# Install Python daemon (NixOS: use nix-shell -p uv first)
uv tool install -e .
export PATH="$HOME/.local/bin:$PATH"

# Register skill + extension with pi
pi install github:PopCat19/browser-harness-pi
```

Or manually:

```bash
mkdir -p ~/.pi/agent/skills/browser-harness
ln -sf "$PWD/SKILL.md" ~/.pi/agent/skills/browser-harness/SKILL.md
ln -sf "$PWD" ~/.pi/agent/extensions/browser-harness
```

## Usage

Start Chrome/Chromium with remote debugging:

```bash
chromium --remote-debugging-port=9222
```

Then in pi:

```
> Open github.com and screenshot the page
```

The LLM invokes `browser_navigate("https://github.com")` then `browser_screenshot()`.

## Architecture

```
index.ts (extension entry)
  ├── daemon.ts (socket comm + lifecycle)
  │     │
  │     │ Unix socket /tmp/bu-default.sock
  │     ▼
  └── src/browser_harness/daemon.py (Python CDP relay)
          │
          │ CDP WebSocket
          ▼
        Chrome / Chromium
```

Pi discovers the extension via `package.json` → `pi.extensions` → `./index.ts`. The daemon auto-starts on first tool call. If the daemon goes stale, the LLM calls `browser_restart_daemon`.

## Design

- **Screenshots first** — coordinate clicks through compositor (works through iframes/shadow DOM)
- **Thin** — no manager layer, no framework. Just CDP commands over a socket.
- **Self-healing** — stale daemon recovery built in. LLM controls it.
- **Real browser** — uses your actual Chrome, already logged in everywhere.

## License

MIT — see upstream [browser-use/browser-harness](https://github.com/browser-use/browser-harness).
