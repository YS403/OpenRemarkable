import { describe, expect, it } from "vitest";

import { parseCalendarLink } from "./fetch";

describe("parseCalendarLink", () => {
  it("accepts Outlook publish links, including webcal://", () => {
    expect(parseCalendarLink(" https://outlook.office365.com/owa/calendar/abc@example.com/def/calendar.ics ", "outlook").hostname).toBe("outlook.office365.com");
    expect(parseCalendarLink("webcal://outlook.live.com/owa/calendar/x/y/calendar.ics", "outlook").protocol).toBe("https:");
  });

  it("accepts Google secret iCal addresses, only for Google", () => {
    const link = "https://calendar.google.com/calendar/ical/alex%40gmail.com/private-0123456789abcdef/basic.ics";
    expect(parseCalendarLink(link, "google").hostname).toBe("calendar.google.com");
    expect(() => parseCalendarLink(link, "outlook")).toThrow("Outlook");
    expect(() => parseCalendarLink("https://outlook.office365.com/owa/calendar/x/y/calendar.ics", "google")).toThrow("Google");
  });

  it.each([
    ["other hosts", "https://example.com/calendar.ics"],
    ["internal addresses", "https://169.254.169.254/latest/meta-data"],
    ["look-alike hosts", "https://outlook.office365.com.evil.example/calendar.ics"],
    ["plain http", "http://outlook.office365.com/owa/calendar/x/y/calendar.ics"],
    ["credentials in the URL", "https://user:pass@outlook.office365.com/owa/calendar.ics"],
    ["odd ports", "https://outlook.office365.com:8443/owa/calendar.ics"],
    ["non-links", "not a link"],
  ])("rejects %s", (_, link) => {
    expect(() => parseCalendarLink(link, "outlook")).toThrow();
    expect(() => parseCalendarLink(link, "google")).toThrow();
  });
});
