import type { AriaNode } from "./ariaTree.js";

const TRANSIENT_ROLES = new Set(["alert", "status", "progressbar"]);

export function isTransientNode(node: AriaNode): boolean {
  return TRANSIENT_ROLES.has(node.role);
}

const ISO_TIMESTAMP = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?\b/g;
const SIMPLE_DATE = /\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g;
const RELATIVE_TIME_AGO = /\b\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\b/gi;
const RELATIVE_TIME_IN = /\bin\s+\d+\s+(?:second|minute|hour|day|week|month|year)s?\b/gi;
const RELATIVE_TIME_NOW = /\bjust now\b/gi;
const TIME_PATTERNS = [ISO_TIMESTAMP, SIMPLE_DATE, RELATIVE_TIME_AGO, RELATIVE_TIME_IN, RELATIVE_TIME_NOW];

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const LONG_HEX = /\b[0-9a-f]{16,}\b/gi;
const LONG_TOKEN = /\b[A-Za-z0-9_-]{24,}\b/g;
const ID_PATTERNS = [UUID, LONG_HEX, LONG_TOKEN];

const NUMBER_TOKEN = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;

export function canonicalizeNumber(raw: string): string {
  const parts = raw.split(/[.,]/);
  if (parts.length === 1) return parts[0] ?? raw;

  const last = parts[parts.length - 1] ?? "";
  if (last.length <= 2) {
    const integerPart = parts.slice(0, -1).join("");
    return `${integerPart}.${last}`;
  }
  return parts.join("");
}

function matchesWhole(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => {
    const anchored = new RegExp(`^(?:${pattern.source})$`, pattern.flags.replace("g", ""));
    return anchored.test(text);
  });
}

function replaceAllPatterns(text: string, patterns: RegExp[], token: string): string {
  return patterns.reduce((acc, pattern) => acc.replace(pattern, token), text);
}

/** Structure-skeleton text mask (engine-spec §4 B.1/B.2): timestamps/ids get their own
 * token, numbers are preserved, everything else collapses to a single <TEXT> marker. */
export function maskText(text: string): string {
  const trimmed = text.trim();
  if (matchesWhole(trimmed, TIME_PATTERNS)) return "<TIME>";
  if (matchesWhole(trimmed, ID_PATTERNS)) return "<ID>";

  let working = replaceAllPatterns(trimmed, TIME_PATTERNS, "<TIME>");
  working = replaceAllPatterns(working, ID_PATTERNS, "<ID>");

  const numbers: string[] = [];
  working = working.replace(NUMBER_TOKEN, (match) => {
    numbers.push(canonicalizeNumber(match));
    return "";
  });

  const specialTokens = [...working.matchAll(/<TIME>|<ID>/g)].map((m) => m[0]);
  const hasOtherWords = working.replace(/<TIME>|<ID>/g, "").trim().length > 0;

  const parts = [...specialTokens, ...numbers];
  if (hasOtherWords) parts.push("<TEXT>");

  return parts.length > 0 ? parts.join(" ") : "<TEXT>";
}

const STACK_LOCATION = /:\d+:\d+\b/g;
const ERROR_NUMBER = /\b\d+\b/g;

/** Separate, simpler mask for console-error dedup signatures (engine-spec §5 C.1):
 * unlike maskText, line/col numbers are masked away rather than preserved. */
export function maskErrorMessage(message: string): string {
  let masked = replaceAllPatterns(message, TIME_PATTERNS, "<TIME>");
  masked = replaceAllPatterns(masked, ID_PATTERNS, "<ID>");
  return masked.replace(STACK_LOCATION, ":<LINE>:<COL>").replace(ERROR_NUMBER, "<NUM>");
}
