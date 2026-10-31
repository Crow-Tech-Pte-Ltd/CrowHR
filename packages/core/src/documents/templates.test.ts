import { ketRequirements, MOM_KETS } from "@crowhr/sg-rules";
import { describe, expect, it } from "vitest";
import { fieldsUsed, inlineText, parseMarkdown, resolveFields } from "./markdown.ts";
import {
  DEFAULT_KET_TEMPLATE,
  DEFAULT_TEMPLATES,
  KET_ITEM_FIELDS,
  mandatoryKetItems,
  validateTemplate,
} from "./templates.ts";

/** add-documents tasks 3.2 and 3.4: restricted Markdown, the field whitelist, and the KET template. */
describe("letter template validation", () => {
  it("rejects raw HTML, images and non-https links, with line numbers", () => {
    const { issues } = validateTemplate(
      "custom",
      [
        "# Hello",
        "",
        "<b>bold</b>",
        "![logo](https://x/y.png)",
        "[site](http://example.com) and [ok](https://crow.sg)",
        "<!-- note -->",
      ].join("\n"),
      "2026-10-31",
    );
    expect(issues.map((i) => [i.line, i.message.split(" ").slice(0, 3).join(" ")])).toEqual([
      [3, "Raw HTML isn't"],
      [3, "Raw HTML isn't"],
      [4, "Images aren't allowed"],
      [5, "Only https links"],
      [6, "Comments are only"],
    ]);
  });

  it("names an unknown field with its line and a suggestion", () => {
    const body = `${"Line\n".repeat(11)}Your pay is {{employee.salary}}.`;
    expect(validateTemplate("custom", body, "2026-10-31").issues).toEqual([
      { line: 12, message: "Unknown field employee.salary on line 12. Did you mean compensation.basic_pay?" },
    ]);
    expect(validateTemplate("custom", "{{employment.jobtitle}}", "2026-10-31").issues[0]?.message).toBe(
      "Unknown field employment.jobtitle on line 1. Did you mean employment.job_title?",
    );
  });

  it("does not offer full NRIC/FIN as a field", () => {
    expect(validateTemplate("custom", "ID {{employee.nric}}", "2026-10-31").issues[0]?.message).toMatch(
      /Full NRIC\/FIN is not a merge field.*employee\.nric_masked/,
    );
  });

  it("parses headings, lists, tables, page breaks and inline styles; values never become markup", () => {
    const { blocks, issues } = parseMarkdown(
      "# Title\n\nHello **{{employee.full_name}}**, *welcome*.\n\n- one\n- two\n\n1. first\n\n| A | B |\n| --- | --- |\n| {{today}} | x |\n\n\\pagebreak\n\nEnd",
    );
    expect(issues).toEqual([]);
    expect(blocks.map((b) => b.t)).toEqual(["heading", "paragraph", "list", "list", "table", "pagebreak", "paragraph"]);
    expect(fieldsUsed(blocks).map((f) => f.id)).toEqual(["employee.full_name", "today"]);
    const resolved = resolveFields(blocks, (id) =>
      id === "employee.full_name" ? "<script>**x**</script>" : "31 Oct 2026",
    );
    const para = resolved[1];
    expect(para?.t === "paragraph" && inlineText(para.children)).toBe("Hello <script>**x**</script>, welcome.");
    expect(para?.t === "paragraph" && para.children[1]).toEqual({
      t: "bold",
      children: [{ t: "text", text: "<script>**x**</script>" }],
    });
  });

  it("ships default templates that pass validation", () => {
    for (const t of DEFAULT_TEMPLATES)
      expect(validateTemplate(t.kind, t.body, "2026-10-31").issues, t.name).toEqual([]);
  });
});

describe("KET template (MOM key employment terms, research/sg-regulatory.md §7)", () => {
  it("the default KET template contains every MOM mandatory item and its fields", () => {
    const all = ketRequirements({ asAt: "2026-10-31" });
    expect(all.source).toBe(MOM_KETS);
    expect(all.items).toHaveLength(18);
    const { blocks } = parseMarkdown(DEFAULT_KET_TEMPLATE);
    const used = new Set(fieldsUsed(blocks).map((f) => f.id));
    for (const item of all.items) {
      expect(DEFAULT_KET_TEMPLATE, item.id).toContain(`<!-- ket:${item.id} -->`);
      const fields = KET_ITEM_FIELDS[item.id];
      expect(fields?.length, item.id).toBeGreaterThan(0);
      for (const f of fields ?? []) expect(used.has(f), `${item.id}: ${f}`).toBe(true);
    }
    expect(mandatoryKetItems("2026-10-31").map((i) => i.id)).not.toContain("place_of_work");
  });

  it("refuses to save a KET template without a mandatory item", () => {
    const withoutHours = DEFAULT_KET_TEMPLATE.replace(
      /<!-- ket:working_arrangements -->[\s\S]*?(?=<!-- ket:salary_period -->)/,
      "",
    );
    const { issues } = validateTemplate("ket", withoutHours, "2026-10-31");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/mandatory item "Working arrangements/);
    // Another kind of letter has no such rule.
    expect(validateTemplate("custom", withoutHours, "2026-10-31").issues).toEqual([]);
  });
});
