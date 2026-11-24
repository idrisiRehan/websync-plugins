export { lintProductFeed } from "./lint.ts";
export type { FeedFinding, LintOptions, ProductFeedResult } from "./lint.ts";
export { detectFormat } from "./read.ts";
// The requirement tables, for tools that want to show which attributes are checked and why.
export { GOOGLE_ATTRIBUTES } from "./google.ts";
export { OPENAI_ATTRIBUTES } from "./openai.ts";
export type { AttributeSpec, FeedFormat, RuleId, Severity, TargetName, ValueType } from "./spec.ts";
