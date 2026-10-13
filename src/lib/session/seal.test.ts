import { describe, expect, it } from "vitest";

import { seal, unseal } from "./seal";

const SECRET = "a".repeat(40);

describe("seal / unseal", () => {
  it("round-trips and never exposes the value", () => {
    const token = seal('{"deviceToken":"secret-device-token"}', SECRET);
    expect(token).not.toContain("secret-device-token");
    expect(unseal(token, SECRET)).toBe('{"deviceToken":"secret-device-token"}');
  });

  it("uses a fresh IV each time", () => {
    expect(seal("same", SECRET)).not.toBe(seal("same", SECRET));
  });

  it("rejects tampering, other keys and garbage", () => {
    const token = seal("value", SECRET);
    const [v, iv, body, tag] = token.split(".");
    // change the first character: the last one can carry only padding bits, which decode the same
    const flipped = (body.startsWith("A") ? "B" : "A") + body.slice(1);
    expect(unseal([v, iv, flipped, tag].join("."), SECRET)).toBeNull();
    expect(unseal(token, "b".repeat(40))).toBeNull();
    expect(unseal("not-a-token", SECRET)).toBeNull();
  });
});

describe("sessions from before the rename", () => {
  it("still opens cookies sealed with the old key label", async () => {
    const { createCipheriv, createHash, randomBytes } = await import("node:crypto");
    const key = createHash("sha256").update(`myremarkable-session:${SECRET}`).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const body = Buffer.concat([cipher.update("legacy", "utf8"), cipher.final()]);
    const token = ["v1", iv.toString("base64url"), body.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
    expect(unseal(token, SECRET)).toBe("legacy");
    expect(unseal(token, "b".repeat(40))).toBeNull();
  });
});
