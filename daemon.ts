// daemon.ts
//
// Purpose: Socket communication with browser-harness Python daemon plus lifecycle management.
//
// This module:
// - Connects to the Unix socket at /tmp/bu-<NAME>.sock
// - Sends JSON-line requests and reads JSON-line responses
// - Ensures the daemon is running before tool calls
// - Exposes restart for LLM self-healing

import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_NAME = process.env["BU_NAME"] ?? "default";
const SOCK_PATH = `/tmp/bu-${DEFAULT_NAME}.sock`;
const LOG_PATH = `/tmp/bu-${DEFAULT_NAME}.log`;
const CONNECT_TIMEOUT = 5000;

function sockExists(): boolean {
  return fs.existsSync(SOCK_PATH);
}

function daemonAlive(): boolean {
  if (!sockExists()) return false;
  return true; // existence check, fast-path; actual health checked via sendRequest
}

async function connect(timeoutMs: number = CONNECT_TIMEOUT): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(SOCK_PATH);
    sock.setTimeout(timeoutMs);
    sock.on("connect", () => {
      sock.setTimeout(0);
      resolve(sock);
    });
    sock.on("timeout", () => {
      sock.destroy();
      reject(new Error(`daemon socket timeout after ${timeoutMs}ms`));
    });
    sock.on("error", (err) => {
      sock.destroy();
      reject(err);
    });
  });
}

interface Request {
  method?: string;
  params?: Record<string, unknown>;
  session_id?: string;
  meta?: string;
  [key: string]: unknown;
}

interface Response {
  result?: unknown;
  error?: string;
  events?: unknown[];
  session_id?: string;
  dialog?: unknown;
  ok?: boolean;
}

export async function sendRequest(req: Request, timeoutMs: number = 15000): Promise<Response> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(SOCK_PATH);
    const chunks: Buffer[] = [];

    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error(`request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    sock.on("connect", () => {
      sock.write(JSON.stringify(req) + "\n");
    });

    sock.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      const data = Buffer.concat(chunks).toString();
      if (data.includes("\n")) {
        clearTimeout(timer);
        sock.end();
        try {
          const parsed = JSON.parse(data.trim().split("\n")[0]) as Response;
          resolve(parsed);
        } catch (e) {
          reject(new Error(`failed to parse daemon response: ${String(e)}`));
        }
      }
    });

    sock.on("error", (err) => {
      clearTimeout(timer);
      sock.destroy();
      reject(err);
    });
  });
}

export async function ensureDaemon(): Promise<void> {
  // Check if daemon is already responding
  if (sockExists()) {
    try {
      const r = await sendRequest({ method: "Target.getTargets", params: {} }, 3000);
      if ("result" in r) return;
    } catch {
      // stale daemon — restart
      await restartDaemon();
    }
  }

  // Start daemon
  const pythonCmd = process.env["BH_PYTHON"] ?? "python3";
  const proc = spawn(pythonCmd, ["-m", "browser_harness.daemon"], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, BU_NAME: DEFAULT_NAME },
  });
  proc.unref();

  // Wait for socket to appear
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (sockExists()) {
      // Wait briefly for daemon to be ready
      await sleep(200);
      try {
        await sendRequest({ method: "Target.getTargets", params: {} }, 5000);
        return;
      } catch {
        await sleep(500);
        continue;
      }
    }
    await sleep(200);
  }

  const logTail = fs.existsSync(LOG_PATH)
    ? fs.readFileSync(LOG_PATH, "utf-8").trim().split("\n").pop() ?? ""
    : "";
  throw new Error(
    `daemon didn't come up within 30s — ${logTail || "check " + LOG_PATH}`
  );
}

export async function restartDaemon(): Promise<void> {
  // Send shutdown
  if (sockExists()) {
    try {
      await sendRequest({ meta: "shutdown" }, 3000);
    } catch {
      // ignore
    }
  }

  // Clean up socket file
  try { fs.unlinkSync(SOCK_PATH); } catch { /* ignore */ }
  try { fs.unlinkSync(`/tmp/bu-${DEFAULT_NAME}.pid`); } catch { /* ignore */ }

  // Brief wait for process to exit
  await sleep(500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function getDaemonInfo(): { name: string; sockPath: string; logPath: string } {
  return { name: DEFAULT_NAME, sockPath: SOCK_PATH, logPath: LOG_PATH };
}
