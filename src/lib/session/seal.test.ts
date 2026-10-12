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
    const flipped = body.slice(0, -1) + (body.endsWith("A") ? "B" : "A");
    expect(unseal([v, iv, flipped, tag].join("."), SECRET)).toBeNull();
    expect(unseal(token, "b".repeat(40))).toBeNull();
    expect(unseal("not-a-token", SECRET)).toBeNull();
  });
});
