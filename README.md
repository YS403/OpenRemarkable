# OpenRemarkable

A Next.js and TypeScript web app for the reMarkable tablet. It fetches your notebooks and PDFs from the reMarkable cloud and converts the raw `.rm` page files (pen strokes, typed text and PDF annotations) into vector PDFs that you can read in the browser. The conversion is our own TypeScript renderer. Its rules for pen shapes, widths, colours and page layout were reverse engineered from the official reMarkable desktop app, so pages look as they do there.

It can also upload PDFs, add typed text to notebooks, and sync day planners built from your Outlook or Google Calendar back to the tablet.

## Planner

![The Planner page, showing the "My day" template for Wednesday 14 October](.github/readme/planner.png)

The Planner turns your calendar into day pages for your reMarkable, so you can plan and take notes by hand.

**How it works:** connect your Outlook or Google Calendar with its private link (read-only), pick a page template and press **sync to reMarkable**. Today and the next 6 days arrive on your tablet as one "Planner" notebook. Sync again whenever your meetings change: changed days are redrawn on the same page, and what you've written stays. You can also turn on prayer times and upload your mosque's timetable to show each prayer window beside your schedule.

## Notebook rendering

A TypeScript renderer converts reMarkable `.rm` notebook files into vector PDFs, so you can read and download your handwritten notes in the browser.

## Tech stack

- **[Next.js](https://nextjs.org) 16** and **React 19**, written in **TypeScript**
- **Tailwind CSS 4** for styling, **Phosphor** for icons
- **[pdf-lib](https://pdf-lib.js.org)** to build PDFs (rendered notebooks and planner pages), **[PDF.js](https://mozilla.github.io/pdf.js/)** to show them
- **[rmapi-js](https://github.com/erikbrinkman/rmapi-js)** to talk to the reMarkable cloud and read `.rm` files
- **[ical.js](https://github.com/kewisch/ical.js)** to read Outlook and Google calendar links
- **Konva** for the editor canvas, **zod** to validate input, **Vitest** for tests
- Ready to host on **Vercel**

## Not affiliated with or endorsed by reMarkable AS
