export const SOURCES = [
  { id: "fda-recalls", name: "FDA Recalls", category: "Federal", url: "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts", type: "Product Safety" },
  { id: "cpsc", name: "CPSC Recalls", category: "Federal", url: "https://www.cpsc.gov/Recalls", type: "Consumer Products" },
  { id: "nhtsa", name: "NHTSA Recalls", category: "Federal", url: "https://www.nhtsa.gov/recalls", type: "Auto/Vehicle" },
  { id: "fsis", name: "FSIS Recalls", category: "Federal", url: "https://www.fsis.usda.gov/recalls", type: "Food Safety" },
  { id: "fda-major", name: "FDA Major Recalls", category: "Federal", url: "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/major-product-recalls", type: "Major Recalls" },
  { id: "fda-maude", name: "FDA MAUDE (Devices)", category: "Medical", url: "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfmaude/search.cfm", type: "Medical Devices" },
  { id: "fda-faers", name: "FDA FAERS (Drugs)", category: "Medical", url: "https://www.fda.gov/drugs/questions-and-answers-fdas-adverse-event-reporting-system-faers/fda-adverse-event-reporting-system-faers-public-dashboard", type: "Pharmaceuticals" },
  { id: "vaers", name: "CDC VAERS", category: "Medical", url: "https://vaers.hhs.gov", type: "Vaccines" },
  { id: "clinicaltrials", name: "ClinicalTrials.gov", category: "Medical", url: "https://clinicaltrials.gov", type: "Clinical Trials" },
  { id: "epa", name: "EPA Enforcement", category: "Federal", url: "https://www.epa.gov/enforcement", type: "Environmental" },
  { id: "sec", name: "SEC Litigation", category: "Federal", url: "https://www.sec.gov/litigation", type: "Securities" },
  { id: "cfpb", name: "CFPB Complaints", category: "Federal", url: "https://www.consumerfinance.gov/data-research/consumer-complaints/", type: "Financial Products" },
  { id: "ftc", name: "FTC Cases", category: "Federal", url: "https://www.ftc.gov/legal-library/browse/cases-proceedings", type: "Deceptive Practices" },
  { id: "jpml", name: "JPML MDL Panel", category: "Judicial", url: "https://www.jpml.uscourts.gov", type: "MDL Tracking" },
  { id: "stanford-scac", name: "Stanford Securities CA", category: "Judicial", url: "https://securities.stanford.edu", type: "Securities Class Actions" },
  { id: "courtlistener", name: "CourtListener / RECAP", category: "Judicial", url: "https://www.courtlistener.com", type: "Federal Court Opinions" },
  { id: "foxbiz", name: "Fox Business Recalls", category: "News", url: "https://www.foxbusiness.com/category/product-recalls", type: "News Aggregator" },
  { id: "prnewswire", name: "PR Newswire Recalls", category: "News", url: "https://www.prnewswire.com/news-releases/consumer-products-retail-latest-news/product-recalls-list/", type: "Press Releases" },
  { id: "classaction", name: "ClassAction.org", category: "Plaintiff Intel", url: "https://www.classaction.org", type: "Active Cases" },
  { id: "topclass", name: "TopClassActions.com", category: "Plaintiff Intel", url: "https://topclassactions.com", type: "Settlements & Cases" },
  { id: "aboutlawsuits", name: "AboutLawsuits.com", category: "Plaintiff Intel", url: "https://www.aboutlawsuits.com", type: "Case Tracking" },
  { id: "ny-dos", name: "NY DOS Recalls", category: "State", url: "https://dos.ny.gov/recall-alerts", type: "State Alerts" },
  { id: "ca-oag", name: "CA Attorney General", category: "State", url: "https://oag.ca.gov/consumers", type: "State Enforcement" },
  { id: "bbb", name: "BBB Complaints", category: "Consumer", url: "https://www.bbb.org", type: "Consumer Complaints" },
];

export const CASE_TYPES = ["Product Liability","Medical Device","Pharmaceutical","Securities Fraud","Environmental/Toxic Tort","Consumer Protection","Data Breach/Privacy","Auto Defect","Food Safety","Financial Products","Employment","Antitrust"];
export const PRIORITIES = ["Critical","High","Medium","Low"];
export const STATUSES = ["New Lead","Investigating","Case Filed","MDL Pending","MDL Active","Settled","Closed"];
export const OUTCOMES = ["certified","denied","settled","pending","mixed"];
export const INDUSTRIES = ["All","Pharmaceutical","Medical Device","Auto","Consumer Products","Tech/Privacy","Financial","Environmental","Food & Beverage","Securities"];
export const HARM_CATEGORIES = ["physical","economic","privacy","property","financial","employment"];
export const PRIORITY_COLORS = { Critical: "#ef4444", High: "#f97316", Medium: "#eab308", Low: "#6b7280" };
export const STATUS_COLORS = { "New Lead":"#3b82f6","Investigating":"#8b5cf6","Case Filed":"#f59e0b","MDL Pending":"#ec4899","MDL Active":"#ef4444","Settled":"#22c55e","Closed":"#6b7280" };
export const OUTCOME_COLORS = { certified: "#22c55e", denied: "#ef4444", settled: "#3b82f6", pending: "#f59e0b", mixed: "#8b5cf6" };
export const INDUSTRY_COLORS = { Pharmaceutical: "#8b5cf6", "Medical Device": "#ef4444", Auto: "#3b82f6", "Consumer Products": "#f59e0b", "Tech/Privacy": "#06b6d4", Financial: "#22c55e", Environmental: "#84cc16", "Food & Beverage": "#f97316", Securities: "#ec4899" };
