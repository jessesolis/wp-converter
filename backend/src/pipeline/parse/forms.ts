import * as cheerio from "cheerio";
import type { CrawlResult } from "../crawl";

export type FormFieldTag = "input" | "select" | "textarea";

export interface FormField {
  tag: FormFieldTag;
  inputType?: string;
  name?: string;
  placeholder?: string;
  required: boolean;
  label?: string;
  options?: string[];
}

export interface ExtractedForm {
  id?: string;
  action?: string;
  method?: string;
  fields: FormField[];
}

export interface PageForms {
  pageUrl: string;
  path: string;
  forms: ExtractedForm[];
}

export interface FormOccurrence {
  pageUrl: string;
  path: string;
  formIndex: number;
  formId?: string;
}

export interface FormVariant {
  fingerprint: string;
  fields: FormField[];
  method?: string;
  formIds: string[];
  occurrences: FormOccurrence[];
}

export interface FormAnalysis {
  variants: FormVariant[];
  pagesWithoutForms: { pageUrl: string; path: string }[];
}

export function extractFormsFromPage(
  html: string,
  pageUrl: string,
  path: string,
): PageForms {
  const $ = cheerio.load(html);
  const forms: ExtractedForm[] = [];

  $("form").each((_, formEl) => {
    const $form = $(formEl);
    // Scorpion marks AJAX search/filter forms with data-search="1".
    // These submit to JS handlers, not server endpoints, and are not
    // user-fillable "true" forms we want to migrate.
    if ($form.attr("data-search") === "1") return;
    const fields: FormField[] = [];

    $form.find("input, select, textarea").each((_, fieldEl) => {
      const $field = $(fieldEl);
      const rawTag = ($field.prop("tagName") ?? "").toString().toLowerCase();
      if (rawTag !== "input" && rawTag !== "select" && rawTag !== "textarea") {
        return;
      }
      const tag = rawTag as FormFieldTag;

      const field: FormField = {
        tag,
        inputType: tag === "input" ? $field.attr("type") : undefined,
        name: $field.attr("name"),
        placeholder: $field.attr("placeholder"),
        required: $field.attr("required") !== undefined,
        label: findLabelFor($form, $field),
      };

      if (tag === "select") {
        const options: string[] = [];
        $field.find("option").each((_, opt) => {
          const text = $(opt).text().trim();
          if (text) options.push(text);
        });
        field.options = options;
      }

      fields.push(field);
    });

    forms.push({
      id: $form.attr("id"),
      action: $form.attr("action"),
      method: $form.attr("method"),
      fields,
    });
  });

  return { pageUrl, path, forms };
}

export function extractAllForms(crawl: CrawlResult): PageForms[] {
  const out: PageForms[] = [];
  for (const page of crawl.pages) {
    if (page.status !== "ok" || !page.fullHtml) continue;
    out.push(extractFormsFromPage(page.fullHtml, page.pageUrl, page.path));
  }
  return out;
}

export function analyzeForms(crawl: CrawlResult): FormAnalysis {
  const pageForms = extractAllForms(crawl);
  const byFingerprint = new Map<string, FormVariant>();
  const pagesWithoutForms: { pageUrl: string; path: string }[] = [];

  for (const page of pageForms) {
    if (page.forms.length === 0) {
      pagesWithoutForms.push({ pageUrl: page.pageUrl, path: page.path });
      continue;
    }
    page.forms.forEach((form, idx) => {
      const fingerprint = fingerprintForm(form);
      let variant = byFingerprint.get(fingerprint);
      if (!variant) {
        variant = {
          fingerprint,
          fields: form.fields,
          method: form.method,
          formIds: [],
          occurrences: [],
        };
        byFingerprint.set(fingerprint, variant);
      }
      if (form.id && !variant.formIds.includes(form.id)) {
        variant.formIds.push(form.id);
      }
      variant.occurrences.push({
        pageUrl: page.pageUrl,
        path: page.path,
        formIndex: idx,
        formId: form.id,
      });
    });
  }

  const variants = [...byFingerprint.values()].sort(
    (a, b) => b.occurrences.length - a.occurrences.length,
  );
  return { variants, pagesWithoutForms };
}

// Structural fingerprint. Deliberately excludes form id, action, and
// field name — Scorpion auto-generates positional identifiers like
// Form_ContactS2 vs Form_ContactS21 and field names like
// ContactS2Form$ITM0$FirstName that differ only by the form's index.
// Excluding them collapses what is operationally the same form template
// onto a single variant while the occurrences list keeps the per-page
// assignment.
function fingerprintForm(form: ExtractedForm): string {
  const fields = form.fields.map((f) => ({
    tag: f.tag,
    inputType: f.inputType,
    placeholder: f.placeholder,
    required: f.required,
    label: f.label,
    options: f.options,
  }));
  return JSON.stringify({ method: form.method, fields });
}

function findLabelFor(
  $form: cheerio.Cheerio<any>,
  $field: cheerio.Cheerio<any>,
): string | undefined {
  const id = $field.attr("id");
  if (id) {
    const $byFor = $form.find(`label[for="${cssEscape(id)}"]`).first();
    if ($byFor.length > 0) return cleanLabel($byFor.text());
  }
  const $wrap = $field.parents("label").first();
  if ($wrap.length > 0) return cleanLabel($wrap.text());
  return undefined;
}

function cleanLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function cssEscape(value: string): string {
  return value.replace(/(["\\])/g, "\\$1");
}
