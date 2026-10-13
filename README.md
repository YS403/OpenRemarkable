# OpenRemarkable

A web app that works alongside your reMarkable tablet. Browse and read the notebooks and PDFs in your reMarkable cloud, add typed text to them, and upload new PDFs. The Planner turns your Outlook or Google Calendar into printable-style day pages, with your meetings, optional prayer times, a to-do list and space for notes. With one click it sends them to your tablet as a single "Planner" notebook.

## Planner

![The Planner page, showing the "My day" template for Wednesday 14 October](.github/readme/planner.png)

The Planner shows the page your tablet will get for one day. Here is what each part does.

### The day page (middle)

- **Arrows and date (top):** move to the previous or next day. The page in the middle shows that day.
- **The page:** exactly what will appear on your tablet. This one uses the **My day** template:
  - **Today:** the whole day from 00:00 to 23:00 on a 24-hour clock. Your meetings appear as boxes at their times, showing the time, title and room.
  - **Prayer strip:** the grey column beside the hours. It shows each prayer window from start to end, e.g. *Fajr 05:30–07:00*. It sits next to your meetings, never on top of them.
  - **To do and Notes:** empty space to write on with your pen.
- **download:** saves this day's page as a PDF on your computer.
- **sync to reMarkable:** sends today and the next 6 days to your tablet as one "Planner" notebook. Press it again any time:
  - new days are added
  - days whose meetings changed are redrawn on the same page
  - anything you already wrote on a page stays where it is

### Settings (right)

- **Template:** pick how your day pages look.
  - **Daily planner:** schedule, top 3 and to-dos.
  - **My day:** 24-hour day with meetings and prayer times, to-dos and notes.
  - **Meeting notes:** an overview, then a page per meeting for notes.
- **Prayer times:** the switch turns prayer times on or off. When it's on, the small upload icon lets you add your mosque's timetable as a JSON file, one or more months at a time. "File format" in that window shows an example.
- **Connected:** the calendars you've linked. They are read-only: the app can see your meetings but never changes them. Use **disconnect** to remove one.
- **Connect:** link a **Google Calendar** or **Outlook** calendar by pasting its private calendar link. The window that opens shows where to find it.
- **How it works:** a short reminder of these steps.

### On the left

- **Notebooks:** browse and read what's in your reMarkable cloud, and upload PDFs.
- **Planner:** this page.
- **Request a feature:** tell us what you'd like next.
- **Connected:** shows whether the app is linked to your reMarkable account.

## Notebook rendering (.rm to PDF)

Handwritten notebooks on the reMarkable are stored as `.rm` files: lists of pen strokes, not images. OpenRemarkable includes a renderer written in TypeScript (`src/lib/rm`) that turns them into clean vector PDFs:

- every pen type: ballpoint, fineliner, marker, pencils, calligraphy, highlighter and eraser, with pressure and speed
- typed text
- the page size and order you set on the tablet, including pages added or moved
- annotations drawn on top of PDFs, placed back onto the original document

It has no framework or Node-only code, so the same code runs on the server or in the browser.

## Tech stack

- **[Next.js](https://nextjs.org) 16** and **React 19**, written in **TypeScript**
- **Tailwind CSS 4** for styling, **Phosphor** for icons
- **[pdf-lib](https://pdf-lib.js.org)** to build PDFs (rendered notebooks and planner pages), **[PDF.js](https://mozilla.github.io/pdf.js/)** to show them
- **[rmapi-js](https://github.com/erikbrinkman/rmapi-js)** to talk to the reMarkable cloud and read `.rm` files
- **[ical.js](https://github.com/kewisch/ical.js)** to read Outlook and Google calendar links
- **Konva** for the editor canvas, **zod** to validate input, **Vitest** for tests
- Ready to host on **Vercel**

## Not affiliated with or endorsed by reMarkable AS
