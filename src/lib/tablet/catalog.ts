/**
 * Apps offered on the App Store page. Plain data, shared by the page and the
 * installer; the files each app puts on the tablet are listed in ./apps.ts.
 */

export type AppId = "alarm";

export interface StoreApp {
  id: AppId;
  name: string;
  summary: string;
  /** shown on the card, one point each */
  details: string[];
}

export const STORE_APPS: StoreApp[] = [
  {
    id: "alarm",
    name: "Alarm",
    summary: "Set an alarm for a time of day. When it's due, a small notification pops up at the top of the screen for 5 seconds, over whatever you're doing.",
    details: [
      "Opens from the sidebar, under Integrations",
      "Keeps running after you close it",
      "An alarm due while the tablet sleeps shows when you wake it",
    ],
  },
];

export const isAppId = (value: string): value is AppId => STORE_APPS.some((app) => app.id === value);

/** Firmware the installer is tested on; others are refused. */
export const SUPPORTED_FIRMWARE = ["3.25.1.1"];
export const SUPPORTED_MODEL = "reMarkable 2.0";
