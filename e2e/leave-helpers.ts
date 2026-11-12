import type { Page } from "@playwright/test";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const todaySg = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
export const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));

/** Picks `iso` in the DatePicker labelled `label` (day buttons are named "Tuesday 10 November 2026"). */
export async function pickDate(page: Page, label: string, iso: string, scope = page.getByRole("dialog")) {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  await scope.getByRole("button", { name: label, exact: true }).click();
  const pop = page.locator("[data-radix-popper-content-wrapper]").last();
  const name = new RegExp(`\\b${d} ${MONTHS[m - 1]} ${y}\\b`);
  // A picker with month and year dropdowns (`yearPicker`, e.g. a date of birth) jumps straight there.
  const year = pop.getByRole("combobox", { name: /year/i });
  if (await year.count()) {
    await year.selectOption(String(y));
    await pop.getByRole("combobox", { name: /month/i }).selectOption(String(m - 1));
  }
  for (let i = 0; i < 3; i++) {
    const day = pop.getByRole("button", { name });
    if (await day.count()) {
      await day.first().click();
      return;
    }
    await pop.getByRole("button", { name: /next month/i }).click();
  }
  throw new Error(`date ${iso} not found in the picker`);
}
