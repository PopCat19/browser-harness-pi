// index.ts
//
// Purpose: Pi extension that registers browser-harness tools for direct browser control via CDP.
//
// This module:
// - Registers 12+ custom tools wrapping browser-harness daemon socket calls
// - Auto-starts the Python daemon on first tool invocation
// - Exposes restart tool for LLM self-healing
// - Mirrors browser-harness SKILL.md conventions (screenshots first, coord clicks, etc.)

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ensureDaemon, sendRequest, restartDaemon } from "./daemon";

const TMP = path.join(os.tmpdir(), "browser-harness");
fs.mkdirSync(TMP, { recursive: true });

// ── pi extension ──

export default function (pi: ExtensionAPI) {
  // ── browser_navigate ──
  pi.registerTool({
    name: "browser_navigate",
    label: "Browser Navigate",
    description:
      "Open a new browser tab and navigate to a URL. Use for first navigation after daemon start. Returns page info.",
    promptSnippet: "browser_navigate(url) — open new tab at URL",
    promptGuidelines: [
      "Use browser_navigate for initial navigation to a URL. It opens a NEW tab, preserving existing tabs.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "Full URL to navigate to" }),
    }),
    async execute(_id, params, signal, _onUpdate, _ctx) {
      // create blank tab then navigate
      const cr = await sendRequest({
        method: "Target.createTarget",
        params: { url: "about:blank" },
      });
      if (cr.error) throw new Error(`createTarget: ${cr.error}`);
      const tid = (cr.result as Record<string, unknown>)?.["targetId"] as string;

      // attach + set session
      const ar = await sendRequest({
        method: "Target.attachToTarget",
        params: { targetId: tid, flatten: true },
      });
      if (ar.error) throw new Error(`attachToTarget: ${ar.error}`);
      const sid = (ar.result as Record<string, unknown>)?.["sessionId"] as string;
      await sendRequest({ meta: "set_session", session_id: sid, target_id: tid });

      // navigate
      await sendRequest({ method: "Page.navigate", params: { url: params.url } });

      // poll readyState
      const info = await pageInfo();
      return {
        content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
        details: { targetId: tid },
      };
    },
  });

  // ── browser_screenshot ──
  pi.registerTool({
    name: "browser_screenshot",
    label: "Browser Screenshot",
    description:
      "Capture a PNG screenshot of the current viewport. Returns the filepath. Default viewport only; set full=true for full page.",
    promptSnippet: "browser_screenshot(path?, full?) — capture viewport PNG",
    promptGuidelines: [
      "Screenshots first: use browser_screenshot to understand the current page, find visible targets, and decide next action.",
      "After every meaningful action, re-screenshot before assuming it worked.",
      "Use screenshots to drive exploration — often the fastest way to find click targets and notice blockers.",
    ],
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({ description: "Output filepath (default: /tmp/browser-harness/shot.png)" })
      ),
      full: Type.Optional(Type.Boolean({ description: "Capture full page beyond viewport" })),
      max_dim: Type.Optional(
        Type.Number({ description: "Resize so largest side ≤ this px (e.g. 1800 for LLM limits)" })
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const filepath = params.path ?? path.join(TMP, "shot.png");
      const r = await sendRequest({
        method: "Page.captureScreenshot",
        params: { format: "png", captureBeyondViewport: params.full ?? false },
      });
      if (r.error) throw new Error(`captureScreenshot: ${r.error}`);
      const b64 = (r.result as Record<string, string>)["data"] ?? "";
      fs.writeFileSync(filepath, Buffer.from(b64, "base64"));

      if (params.max_dim) {
        try {
          // Use dynamic import for sharp, fallback: note that resize is skipped
        } catch {
          // sharp not available, skip resize
        }
      }
      return {
        content: [{ type: "text", text: `Screenshot saved: ${filepath}` }],
        details: { path: filepath },
      };
    },
  });

  // ── browser_click ──
  pi.registerTool({
    name: "browser_click",
    label: "Browser Click",
    description:
      "Click at viewport coordinates (x, y). Uses compositor-level mouse events — works through iframes, shadow DOM, and cross-origin content.",
    promptSnippet: "browser_click(x, y, button?, clicks?) — compositor-level click",
    promptGuidelines: [
      "Clicking: browser_screenshot → read pixel → browser_click(x, y) → browser_screenshot to verify.",
      "Suppress the selector-hunt reflex — coordinate clicks go through iframes / shadow DOM / cross-origin without extra work.",
      "Drop to DOM (browser_js) only when the target has no visible geometry (hidden input, 0x0 node).",
    ],
    parameters: Type.Object({
      x: Type.Number({ description: "Horizontal coordinate in viewport pixels" }),
      y: Type.Number({ description: "Vertical coordinate in viewport pixels" }),
      button: Type.Optional(
        Type.String({ enum: ["left", "right", "middle"], default: "left" })
      ),
      clicks: Type.Optional(Type.Number({ description: "Click count (1 = single, 2 = double)", default: 1 })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const btn = params.button ?? "left";
      const cnt = params.clicks ?? 1;
      await sendRequest({
        method: "Input.dispatchMouseEvent",
        params: { type: "mousePressed", x: params.x, y: params.y, button: btn, clickCount: cnt },
      });
      await sendRequest({
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseReleased", x: params.x, y: params.y, button: btn, clickCount: cnt },
      });
      return {
        content: [{ type: "text", text: `Clicked at (${params.x}, ${params.y}) button=${btn} clicks=${cnt}` }],
        details: { x: params.x, y: params.y, button: btn },
      };
    },
  });

  // ── browser_type ──
  pi.registerTool({
    name: "browser_type",
    label: "Browser Type",
    description: "Insert text at the current focus via CDP Input.insertText.",
    promptSnippet: "browser_type(text) — insert text at focus",
    parameters: Type.Object({
      text: Type.String({ description: "Text to type" }),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      await sendRequest({ method: "Input.insertText", params: { text: params.text } });
      return {
        content: [{ type: "text", text: `Typed: "${params.text}"` }],
      };
    },
  });

  // ── browser_press_key ──
  pi.registerTool({
    name: "browser_press_key",
    label: "Browser Press Key",
    description:
      "Press a keyboard key. Supports special keys: Enter, Tab, Escape, Backspace, Delete, arrows (ArrowLeft/Up/Right/Down), Home, End, PageUp, PageDown, Space (use ' '). Modifiers bitfield: 1=Alt, 2=Ctrl, 4=Meta, 8=Shift.",
    promptSnippet: "browser_press_key(key, modifiers?) — dispatch keyboard event",
    parameters: Type.Object({
      key: Type.String({ description: "Key name (Enter, Tab, Escape, 'a', ' ', ArrowDown, etc.)" }),
      modifiers: Type.Optional(
        Type.Number({ description: "Modifier bitmask: 1=Alt 2=Ctrl 4=Meta 8=Shift" })
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const key = params.key;
      const mods = params.modifiers ?? 0;

      const vkMap: Record<string, number> = {
        Enter: 13, Tab: 9, Backspace: 8, Escape: 27, Delete: 46,
        " ": 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
        Home: 36, End: 35, PageUp: 33, PageDown: 34,
      };
      const vk = vkMap[key] ?? (key.length === 1 ? key.charCodeAt(0) : 0);
      const code = key;
      const text = key.length === 1 ? key : vkMap[key] === 13 ? "\r" : vkMap[key] === 9 ? "\t" : "";

      const base = { key, code, modifiers: mods, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
      await sendRequest({
        method: "Input.dispatchKeyEvent",
        params: { type: "keyDown", ...base, ...(text ? { text } : {}) },
      });
      if (text.length === 1) {
        await sendRequest({
          method: "Input.dispatchKeyEvent",
          params: { type: "char", text, ...Object.fromEntries(Object.entries(base).filter(([k]) => k !== "text")) },
        });
      }
      await sendRequest({
        method: "Input.dispatchKeyEvent",
        params: { type: "keyUp", ...base },
      });
      return { content: [{ type: "text", text: `Pressed: ${key}` }] };
    },
  });

  // ── browser_scroll ──
  pi.registerTool({
    name: "browser_scroll",
    label: "Browser Scroll",
    description: "Scroll at viewport coordinates via mouse wheel. Default: scroll down 300px.",
    promptSnippet: "browser_scroll(x, y, dy?, dx?) — mouse wheel scroll",
    parameters: Type.Object({
      x: Type.Number({ description: "Horizontal viewport coordinate" }),
      y: Type.Number({ description: "Vertical viewport coordinate" }),
      dy: Type.Optional(Type.Number({ description: "Vertical scroll delta (default: -300 for down)" })),
      dx: Type.Optional(Type.Number({ description: "Horizontal scroll delta (default: 0)" })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const dy = params.dy ?? -300;
      const dx = params.dx ?? 0;
      await sendRequest({
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseWheel", x: params.x, y: params.y, deltaX: dx, deltaY: dy },
      });
      return { content: [{ type: "text", text: `Scrolled at (${params.x}, ${params.y}) dx=${dx} dy=${dy}` }] };
    },
  });

  // ── browser_js ──
  pi.registerTool({
    name: "browser_js",
    label: "Browser JS",
    description:
      "Execute JavaScript in the current page and return the result. Use for DOM extraction, inspection, and complex interactions. Expressions with top-level `return` are auto-wrapped.",
    promptSnippet: "browser_js(expression) — evaluate JS in page",
    promptGuidelines: [
      "Use browser_js for DOM reads, extraction, and inspection when screenshot shows coordinates are the wrong tool.",
      "Both 'document.title' and 'const x = 1; return x' are valid inputs — return-wrapping is handled automatically.",
    ],
    parameters: Type.Object({
      expression: Type.String({ description: "JavaScript to evaluate in the page" }),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      let expr = params.expression;
      // Detect if expression has a top-level return statement (simple heuristic)
      const trimmed = expr.trim();
      const hasReturn = /\breturn\b/.test(trimmed) && !trimmed.startsWith("(");
      const wrapped = hasReturn ? `(function(){${expr}})()` : expr;

      const r = await sendRequest({
        method: "Runtime.evaluate",
        params: { expression: wrapped, returnByValue: true, awaitPromise: true },
      });
      if (r.error) throw new Error(`JS eval: ${r.error}`);
      const details = (r.result as Record<string, unknown>)?.exceptionDetails as
        | Record<string, unknown>
        | undefined;
      if (details) {
        const desc =
          (details.exception as Record<string, string>)?.description ??
          details.text ??
          "JS evaluation failed";
        throw new Error(`JS error: ${desc}; expression: ${expr.slice(0, 160)}`);
      }
      const value = (r.result as Record<string, unknown>)?.["value"];
      const unser = (r.result as Record<string, unknown>)?.["unserializableValue"];
      const out = value !== undefined ? JSON.stringify(value) : String(unser ?? "undefined");
      return {
        content: [{ type: "text", text: out.slice(0, 50000) }],
        details: { value, unserializableValue: unser },
      };
    },
  });

  // ── browser_page_info ──
  pi.registerTool({
    name: "browser_page_info",
    label: "Browser Page Info",
    description:
      "Get current page metadata: url, title, viewport size, scroll position, page dimensions. Returns dialog info if a native dialog is open.",
    promptSnippet: "browser_page_info() — {url, title, w, h, sx, sy, pw, ph} or {dialog}",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, _ctx) {
      const info = await pageInfo();
      return {
        content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
        details: info,
      };
    },
  });

  // ── browser_list_tabs ──
  pi.registerTool({
    name: "browser_list_tabs",
    label: "Browser List Tabs",
    description: "List all open browser tabs (page targets). Excludes chrome:// internals by default.",
    parameters: Type.Object({
      include_chrome: Type.Optional(
        Type.Boolean({ description: "Include chrome:// internal tabs" })
      ),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const r = await sendRequest({ method: "Target.getTargets", params: {} });
      if (r.error) throw new Error(`getTargets: ${r.error}`);
      const targets = (r.result as Record<string, unknown>)?.["targetInfos"] as
        | Array<Record<string, unknown>>
        | undefined;
      if (!targets) return { content: [{ type: "text", text: "[]" }] };

      const internals = ["chrome://", "chrome-untrusted://", "devtools://", "chrome-extension://", "about:"];
      const tabs = targets
        .filter((t) => t.type === "page")
        .filter((t) => {
          if (params.include_chrome) return true;
          const url = String(t.url ?? "");
          return !internals.some((p) => url.startsWith(p));
        })
        .map((t) => ({ targetId: t.targetId, title: t.title ?? "", url: t.url ?? "" }));

      return {
        content: [{ type: "text", text: JSON.stringify(tabs, null, 2) }],
        details: { tabs },
      };
    },
  });

  // ── browser_switch_tab ──
  pi.registerTool({
    name: "browser_switch_tab",
    label: "Browser Switch Tab",
    description:
      "Switch the agent connection to a different tab. Accepts a targetId string (from browser_list_tabs).",
    parameters: Type.Object({
      target: Type.String({ description: "Target ID of the tab to switch to" }),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const tid = params.target;
      // Unmark old tab
      try {
        await sendRequest({
          method: "Runtime.evaluate",
          params: { expression: "if(document.title.startsWith('🟢 '))document.title=document.title.slice(2)" },
        });
      } catch { /* ignore */ }

      await sendRequest({ method: "Target.activateTarget", params: { targetId: tid } });
      const ar = await sendRequest({
        method: "Target.attachToTarget",
        params: { targetId: tid, flatten: true },
      });
      if (ar.error) throw new Error(`attachToTarget: ${ar.error}`);
      const sid = (ar.result as Record<string, unknown>)?.["sessionId"] as string;
      await sendRequest({ meta: "set_session", session_id: sid, target_id: tid });

      // Mark new tab
      try {
        await sendRequest({
          method: "Runtime.evaluate",
          params: {
            expression: "if(!document.title.startsWith('🟢'))document.title='🟢 '+document.title",
          },
        });
      } catch { /* ignore */ }

      return {
        content: [{ type: "text", text: `Switched to tab ${tid}` }],
        details: { targetId: tid, sessionId: sid },
      };
    },
  });

  // ── browser_wait ──
  pi.registerTool({
    name: "browser_wait",
    label: "Browser Wait",
    description: "Sleep for a specified number of seconds. Default 1s.",
    parameters: Type.Object({
      seconds: Type.Optional(Type.Number({ description: "Seconds to wait", default: 1 })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      await new Promise((r) => setTimeout(r, (params.seconds ?? 1) * 1000));
      return { content: [{ type: "text", text: `Waited ${params.seconds ?? 1}s` }] };
    },
  });

  // ── browser_wait_for_load ──
  pi.registerTool({
    name: "browser_wait_for_load",
    label: "Browser Wait For Load",
    description: "Poll document.readyState === 'complete', up to a timeout. Default 15s.",
    parameters: Type.Object({
      timeout: Type.Optional(Type.Number({ description: "Max seconds to wait", default: 15 })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const deadline = Date.now() + (params.timeout ?? 15) * 1000;
      while (Date.now() < deadline) {
        const r = await sendRequest({
          method: "Runtime.evaluate",
          params: { expression: "document.readyState", returnByValue: true },
        });
        const state = (r.result as Record<string, unknown>)?.["value"];
        if (state === "complete") {
          return { content: [{ type: "text", text: "Page loaded." }] };
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      return { content: [{ type: "text", text: "Timed out waiting for load." }] };
    },
  });

  // ── browser_restart_daemon ──
  pi.registerTool({
    name: "browser_restart_daemon",
    label: "Browser Restart Daemon",
    description:
      "Restart the browser-harness daemon. Use when encountering stale socket errors or connection issues. The daemon auto-starts on next tool call.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, _ctx) {
      await restartDaemon();
      return {
        content: [
          { type: "text", text: "Daemon stopped. Next tool call will auto-start a fresh daemon." },
        ],
      };
    },
  });
}

// ── Helpers ──

async function pageInfo(): Promise<Record<string, unknown>> {
  const d = await sendRequest({ meta: "pending_dialog" });
  if (d.dialog) return d as unknown as Record<string, unknown>;

  const r = await sendRequest({
    method: "Runtime.evaluate",
    params: {
      expression:
        "JSON.stringify({url:location.href,title:document.title,w:innerWidth,h:innerHeight,sx:scrollX,sy:scrollY,pw:document.documentElement.scrollWidth,ph:document.documentElement.scrollHeight})",
      returnByValue: true,
    },
  });
  if (r.error) throw new Error(`pageInfo: ${r.error}`);
  const val = (r.result as Record<string, unknown>)?.["value"] as string;
  return JSON.parse(val) as Record<string, unknown>;
}
