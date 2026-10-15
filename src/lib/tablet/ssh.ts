import "server-only";

import { createHash } from "node:crypto";
import net from "node:net";

import { Client } from "ssh2";

/** The tablet's address on the USB-C network it creates when plugged in. */
export const TABLET_HOST = "10.11.99.1";
const PORT = 22;

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** An open SSH session to the tablet. */
export interface Tablet {
  /** Run a shell command; `input` is written to its stdin. */
  exec(command: string, options?: { input?: Uint8Array; timeoutMs?: number }): Promise<ExecResult>;
  /** Write a file on the tablet (through `cat`, so no SFTP server is needed). */
  put(path: string, bytes: Uint8Array): Promise<void>;
  close(): void;
}

export class TabletError extends Error {
  constructor(
    message: string,
    readonly kind: "unreachable" | "auth" | "host-key" | "command" | "not-paired" | "busy",
  ) {
    super(message);
    this.name = "TabletError";
  }
}

/** Single-quote a value for the tablet's shell. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** OpenSSH-style fingerprint of a host key: SHA256:<base64, no padding>. */
export function fingerprint(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

/** Is anything listening on the tablet's SSH port? (Is the tablet plugged in?) */
export function reachable(timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: TABLET_HOST, port: PORT });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/**
 * Connect as root. `acceptHost` decides whether the tablet's host key is the
 * expected one (it is pinned on first pairing), so a different device on the
 * same address is refused.
 */
export function connectTablet(
  auth: { privateKey: string } | { password: string },
  acceptHost: (fingerprint: string) => boolean,
): Promise<{ tablet: Tablet; hostFingerprint: string }> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let hostFingerprint = "";
    let hostRejected = false;
    client
      .on("ready", () => resolve({ tablet: wrap(client), hostFingerprint }))
      .on("error", (error: Error & { level?: string }) => {
        client.end();
        if (hostRejected) reject(new TabletError("This isn't the tablet that was set up here (its SSH key is different). Forget the tablet and connect again.", "host-key"));
        else if (error.level === "client-authentication") reject(new TabletError("The tablet didn't accept the password.", "auth"));
        else reject(new TabletError(`Couldn't reach the tablet: ${error.message}`, "unreachable"));
      })
      .connect({
        host: TABLET_HOST,
        port: PORT,
        username: "root",
        readyTimeout: 10_000,
        ...auth,
        hostVerifier: (key: Buffer) => {
          hostFingerprint = fingerprint(key);
          hostRejected = !acceptHost(hostFingerprint);
          return !hostRejected;
        },
      });
  });
}

function wrap(client: Client): Tablet {
  const exec: Tablet["exec"] = (command, { input, timeoutMs = 120_000 } = {}) =>
    new Promise((resolve, reject) => {
      client.exec(command, (error, stream) => {
        if (error) return reject(new TabletError(error.message, "command"));
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        const timer = setTimeout(() => {
          stream.close();
          reject(new TabletError(`The tablet took too long to answer (${Math.round(timeoutMs / 1000)} s).`, "command"));
        }, timeoutMs);
        stream.on("data", (chunk: Buffer) => out.push(chunk));
        stream.stderr.on("data", (chunk: Buffer) => err.push(chunk));
        stream.on("close", (code: number | null) => {
          clearTimeout(timer);
          resolve({ code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
        });
        stream.end(input ? Buffer.from(input) : undefined);
      });
    });

  return {
    exec,
    async put(path, bytes) {
      const result = await exec(`cat > ${shellQuote(path)}`, { input: bytes });
      if (result.code !== 0) throw new TabletError(`Couldn't write ${path}: ${result.stderr.trim() || `exit ${result.code}`}`, "command");
    },
    close: () => client.end(),
  };
}
