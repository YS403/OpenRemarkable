import { describe, expect, it } from "vitest";

import { localOnly } from "./session";

const request = (method: string, headers: Record<string, string>) => new Request("http://localhost:3000/api/tablet", { method, headers });

describe("localOnly", () => {
  it("allows the app's own pages on localhost", () => {
    expect(localOnly(request("GET", { host: "localhost:3000" }))).toBeNull();
    expect(localOnly(request("POST", { host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin" }))).toBeNull();
    expect(localOnly(request("POST", { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" }))).toBeNull();
  });

  it("refuses other host names (DNS rebinding)", () => {
    expect(localOnly(request("GET", { host: "evil.example:3000" }))?.status).toBe(403);
    expect(localOnly(request("GET", { host: "192.168.1.20:3000" }))?.status).toBe(403);
  });

  it("refuses changes from other sites", () => {
    expect(localOnly(request("POST", { host: "localhost:3000", origin: "https://evil.example" }))?.status).toBe(403);
    expect(localOnly(request("POST", { host: "localhost:3000" }))?.status).toBe(403);
    expect(localOnly(request("POST", { host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "cross-site" }))?.status).toBe(403);
  });
});
