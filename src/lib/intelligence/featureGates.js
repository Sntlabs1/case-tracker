// Feature gating for the partnership-match pivot.
//
// The platform is moving from "predict emerging cases" to "match credit.com clients
// against KNOWN cases (settled + active)." Predictive fields stay in the data model
// for the Research surface, but they should not render in the day-to-day match flow.
//
// Use isResearchSurface(tabId) before rendering any field marked PREDICTIVE_FIELDS,
// and use isMatchSurface(tabId) when you want to know we're on a partnership-match
// screen (Daily Feed, Clients, TCPA Cases, Campaigns, Intake, Dashboard).
//
// Tabs not listed in either set (Knowledge Base, Case Tracker, Case Intelligence,
// Chat, Sources) are neutral — they show whatever they show.
//
// Phase 1 uses this only as a constants source. Phase 5 wires it into App.jsx
// and renders predictive fields conditionally.

export const RESEARCH_SURFACES = new Set([
  "scanner",   // current AI Scanner tab — phase 5 renames to "Research"
  "research",  // post-rename id
  "leads",     // Leads Inbox demoted under Research in phase 5
  "trends",    // Trends demoted under Research in phase 5
]);

export const MATCH_SURFACES = new Set([
  "dashboard",
  "dailyFeed",
  "clients",
  "tcpaCases",
  "campaigns",
  "intake",
]);

// Fields produced by the predictive deep-analysis prompt (kbRubric.js lines 188-194
// and 382-388). They remain in the lead schema but should only be rendered on a
// research surface.
export const PREDICTIVE_FIELDS = [
  "opportunityStatus",
  "daysToAct",
  "targetingReadiness",
  "targetingReadinessReason",
  "caseStage",
  "caseStageRationale",
];

export function isResearchSurface(tabId) {
  return RESEARCH_SURFACES.has(tabId);
}

export function isMatchSurface(tabId) {
  return MATCH_SURFACES.has(tabId);
}

export function shouldRenderPredictive(tabId) {
  return isResearchSurface(tabId);
}
