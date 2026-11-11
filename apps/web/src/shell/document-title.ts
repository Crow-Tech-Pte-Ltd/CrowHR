import * as React from "react";

/** The title in index.html: "Crow HR", or "Crow HR demo" in the browser demo. */
const BASE_TITLE = typeof document === "undefined" ? "Crow HR" : document.title || "Crow HR";

/** `Leave · Crow HR` from a page's first heading; just the base title when there is none. */
export function titleFor(heading: string | null | undefined, base = BASE_TITLE): string {
  const text = heading?.replace(/\s+/g, " ").trim();
  return text ? `${text} · ${base}` : base;
}

/**
 * Keeps `document.title` in step with the page's `h1` (WCAG 2.4.2 Page Titled), so browser tabs,
 * history and screen readers name each page. Every screen has exactly one `h1`, including the
 * sign-in and setup pages, so following it needs no per-route titles.
 */
export function useDocumentTitle(): void {
  React.useEffect(() => {
    const root = document.getElementById("root") ?? document.body;
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = titleFor(root.querySelector("h1")?.textContent);
      if (document.title !== next) document.title = next;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}
