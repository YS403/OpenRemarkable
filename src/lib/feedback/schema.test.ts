import { describe, expect, it } from "vitest";

import { featureRequestSchema } from "./schema";

describe("featureRequestSchema", () => {
  it("needs only a message; email may be blank", () => {
    expect(featureRequestSchema.safeParse({ message: "  Dark mode please  ", email: "", page: "/" })).toMatchObject({
      success: true,
      data: { message: "Dark mode please" },
    });
  });

  it("rejects too-short messages and malformed emails", () => {
    expect(featureRequestSchema.safeParse({ message: "hi", page: "/" }).success).toBe(false);
    expect(featureRequestSchema.safeParse({ message: "Dark mode", email: "nope", page: "/" }).success).toBe(false);
  });
});
