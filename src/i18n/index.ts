import { en, type MessageKey } from "./en";

/** Look up a UI string and fill `{name}` placeholders. Copy never lives in components. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const template: string = en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export type { MessageKey };
