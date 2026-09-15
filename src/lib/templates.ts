/**
 * Simple {{placeholder}} template rendering for message bodies/subjects
 * stored in Settings. Kept intentionally dependency-free.
 */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/{{\s*(\w+)\s*}}/g, (_match, key: string) => {
    return key in vars ? String(vars[key]) : `{{${key}}}`;
  });
}
