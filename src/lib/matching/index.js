export {
  RULE_WEIGHTS,
  DISQUALIFY as TCPA_DISQUALIFY,
  scoreTcpaPair,
} from "./tcpaMatchRubric.js";

export {
  MASS_TORT_WEIGHTS,
  DISQUALIFY as MASS_TORT_DISQUALIFY,
  scoreMassTortPair,
} from "./massTortMatchRubric.js";

export {
  CREDITOR_TO_BUYERS,
  BUYER_ALIASES,
  CREDITOR_ALIASES,
  BUYER_TO_CREDITORS,
  resolveCreditorKey,
  resolveBuyerKey,
  getTypicalCollectors,
  getTypicalCreditors,
  chainMatch,
} from "./debtCollectorMap.js";
