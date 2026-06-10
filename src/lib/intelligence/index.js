export {
  KB_RUBRIC,
  QUICK_TRIAGE_PROMPT,
  FIVE_DIM_SCORING,
  DEEP_ANALYSIS_PROMPT,
  SCORING_SYSTEM_PROMPT,
  buildKBIndex,
  buildDeepAnalysisPromptWithKB,
} from "./kbRubric.js";

export {
  RESEARCH_SURFACES,
  MATCH_SURFACES,
  PREDICTIVE_FIELDS,
  isResearchSurface,
  isMatchSurface,
  shouldRenderPredictive,
} from "./featureGates.js";

export {
  buildClientReport,
  renderHtml,
  renderCsv,
} from "./reportBuilder.js";

export {
  parseDollarRange,
  estimateViolations,
  estimateRecovery,
  aggregateRecovery,
  formatUSD,
} from "./recoveryEstimate.js";

export {
  claimGuidance,
  claimGuidanceCompact,
} from "./claimGuidance.js";
