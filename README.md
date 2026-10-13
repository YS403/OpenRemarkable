# OpenRemarkable

A web app that works alongside your reMarkable tablet. Browse and read the notebooks and PDFs in your reMarkable cloud, add typed text to them, and upload new PDFs. The Planner turns your Outlook or Google Calendar into printable-style day pages, with your meetings, optional prayer times, a to-do list and space for notes. With one click it sends them to your tablet as a single "Planner" notebook.

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
