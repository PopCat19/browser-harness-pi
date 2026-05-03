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

- **Screenshots first** - coordinate clicks through compositor (works through iframes/shadow DOM)
- **Thin** - no manager layer, no framework. Just CDP commands over a socket.
- **Self-healing** - stale daemon recovery built in. LLM controls it.
- **Real browser** - uses your actual Chrome, already logged in everywhere.

## License

MIT - see upstream [browser-use/browser-harness](https://github.com/browser-use/browser-harness).
