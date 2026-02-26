// ============================================================
// CAUSE OF ACTION LIBRARY
// 18 causes of action covering the full class action landscape
// Each entry: legal elements, proof requirements, class cert path,
// sovereign immunity analysis, ideal plaintiff profile, red flags
// ============================================================

export const CAUSES_OF_ACTION = [

  // ─── PRODUCT LIABILITY ────────────────────────────────────────────────────

  {
    id: "product-strict-liability",
    name: "Product Liability — Strict Liability",
    category: "Product Liability",
    overview: "Manufacturer or seller is liable for a defective product regardless of fault. No need to prove negligence — only that the product was defective and the defect caused harm. The most common vehicle for mass tort class actions and MDLs.",
    elements: [
      { element: "Product was in the stream of commerce", description: "Defendant manufactured, distributed, or sold the product commercially.", proofRequired: "Sales records, distribution chain documentation, defendant's admissions", classwide: true },
      { element: "Product was defective", description: "Design defect (unsafe design), manufacturing defect (deviated from intended design), or failure to warn (inadequate warnings about known risks).", proofRequired: "Expert engineering/scientific testimony, FDA/CPSC/NHTSA recall notices, internal testing records, comparable product comparisons", classwide: true },
      { element: "Defect existed when it left defendant's control", description: "The defect was present at point of sale, not introduced by plaintiff or third party.", proofRequired: "Chain of custody, product inspection, elimination of alternative causation", classwide: true },
      { element: "Defect caused plaintiff's injury (general causation)", description: "The type of defect at issue is capable of causing the type of injury alleged — proven at class level.", proofRequired: "Epidemiological studies, peer-reviewed literature, FDA safety communications, expert testimony", classwide: true },
      { element: "Defect caused this plaintiff's specific injury (specific causation)", description: "This particular plaintiff's injury was actually caused by this product. Often the main individual issue.", proofRequired: "Medical records, exposure history, differential diagnosis ruling out other causes", classwide: false },
      { element: "Plaintiff suffered cognizable damages", description: "Physical injury, economic loss, or property damage directly resulting from the defect.", proofRequired: "Medical bills, lost wages, expert economic testimony", classwide: false },
    ],
    classActionViability: {
      rating: "A",
      explanation: "Strong certification path when there is a uniform defect across all products (same batch, same model, same formulation). The defect question and general causation are common. Specific causation and damages are individual but can be handled through subclasses, bellwether trials, or claims processes after class cert."
    },
    certificationPath: "Rule 23(b)(3) — uniform product defect creates predominating common questions. Rule 23(b)(2) available for injunctive relief (recall, replacement). MDL consolidation preferred for mass personal injury cases.",
    sovereignImmunity: "Not applicable — private defendants. Exception: government contractor defense (Boyle v. United Technologies, 1988) — if product was built to government specs and contractor warned government of known risks, immunity may attach.",
    typicalDamages: { perClaimant: "$5K–$500K+ (personal injury); $50–$500 (economic loss/recall only)", aggregate: "$100M–$10B for major product recalls with physical injury" },
    daubert: "Expert required for: (1) general causation (epidemiology, toxicology), (2) specific causation (differential diagnosis), (3) defect mechanism (engineering/materials science), (4) damages (economics). Daubert is existential — Zantac MDL dismissed entirely when general causation experts excluded.",
    keyPrecedents: [
      "Greenman v. Yuba Power Products (1963) — established strict liability doctrine",
      "Restatement (Third) of Torts §2 — design defect, manufacturing defect, failure to warn",
      "In re Zantac (Ranitidine) MDL (2022) — ALL claims dismissed after Daubert exclusion of causation experts",
      "Amchem Products v. Windsor (1997) — settlement class cert standards for mass tort",
    ],
    classificationSignals: ["FDA recall", "CPSC recall", "NHTSA defect investigation", "uniform product defect", "class action filed", "MDL petition", "personal injury lawsuit", "failure to warn"],
    idealPlaintiffProfile: "Used the product as directed for the recommended duration. Has documented medical diagnosis of the alleged injury from a treating physician (not retained expert). Has medical records predating the filing that show injury consistent with exposure. No significant alternative exposure or pre-existing condition that complicates specific causation. Purchased product and can document purchase (receipt, insurance records, pharmacy records).",
    redFlags: [
      "General causation science is disputed or novel — Daubert risk is existential",
      "Long latency period + multiple exposure sources = specific causation nightmare",
      "Individual variations in product use, dosage, or duration destroy commonality",
      "Defendant has filed or is likely to file divisive merger bankruptcy (J&J LTL strategy)",
      "Government contractor defense applies if product built to federal specs",
    ],
    timeToResolution: "4–10 years (MDL)",
    feeStructure: "33–40% contingency; MDL common benefit fund typically 6–9% additional",
    watchOut: "Never accept clients until general causation science is independently validated by peer-reviewed studies — not just retained experts. The Zantac MDL destroyed careers and cost firms hundreds of millions after 70,000 clients were taken in based on unproven science.",
  },

  {
    id: "product-negligence",
    name: "Product Liability — Negligence",
    category: "Product Liability",
    overview: "Defendant failed to exercise reasonable care in design, manufacture, testing, or warning about its product. Requires proof of fault, unlike strict liability. Often pled alongside strict liability.",
    elements: [
      { element: "Duty of care", description: "Manufacturer/seller owed a duty of reasonable care to consumers and foreseeable users.", proofRequired: "Established by law in most jurisdictions — minimal proof required", classwide: true },
      { element: "Breach of duty", description: "Defendant failed to meet the standard of care — negligent design, negligent manufacture, negligent testing, failure to warn of known risks.", proofRequired: "Expert testimony on industry standards, defendant's internal R&D records, testing protocols, regulatory submissions", classwide: true },
      { element: "Causation (actual and proximate)", description: "Defendant's breach was the actual and proximate cause of plaintiff's injury.", proofRequired: "Same as strict liability causation — general and specific causation experts", classwide: false },
      { element: "Damages", description: "Plaintiff suffered legally cognizable harm.", proofRequired: "Medical records, economic loss documentation", classwide: false },
    ],
    classActionViability: {
      rating: "B+",
      explanation: "Slightly weaker than strict liability for class cert because breach analysis can have individual components. However, when defendant had a company-wide policy of ignoring known risks (as shown through internal documents), breach becomes a common question."
    },
    certificationPath: "Rule 23(b)(3) — negligent design/warning is common; causation/damages are individual. Most effective when internal documents show uniform corporate knowledge of risks.",
    sovereignImmunity: "Not applicable for private defendants. For government negligence, see FTCA.",
    typicalDamages: { perClaimant: "Same as strict liability", aggregate: "Same as strict liability" },
    daubert: "Same as strict liability — causation experts are critical.",
    keyPrecedents: [
      "MacPherson v. Buick Motor Co. (1916) — extended duty to all foreseeable users",
      "Grimshaw v. Ford Motor Co. (1981) — punitive damages for knowing disregard of safety (Ford Pinto)",
    ],
    classificationSignals: ["Internal company documents", "knowingly sold defective", "failed to recall", "ignored safety reports"],
    idealPlaintiffProfile: "Same as strict liability, plus: plaintiff can show they would have behaved differently with adequate warning (heeded warning doctrine).",
    redFlags: ["Same as strict liability", "Comparative negligence in plaintiff-friendly states can reduce recovery"],
    timeToResolution: "4–10 years",
    feeStructure: "33–40% contingency",
    watchOut: "Plead alongside strict liability — negligence adds the corporate misconduct narrative that drives punitive damages and settlement pressure.",
  },

  // ─── CONSUMER PROTECTION ─────────────────────────────────────────────────

  {
    id: "consumer-protection-udap",
    name: "Consumer Protection — State UDAP Statutes",
    category: "Consumer Protection",
    overview: "State unfair and deceptive acts and practices (UDAP) statutes prohibit false advertising, deceptive trade practices, and unfair business conduct. Key advantage: many states (NY GBL §349, CA UCL/FAL, IL ICFA) do NOT require individual reliance, making class cert far easier than common law fraud.",
    elements: [
      { element: "Defendant engaged in deceptive or unfair act or practice", description: "A statement, omission, or practice that is materially misleading to a reasonable consumer.", proofRequired: "The advertising/labeling itself, consumer surveys showing perception, expert marketing testimony", classwide: true },
      { element: "Act or practice was in trade or commerce", description: "Defendant was acting as a business, not in a personal capacity.", proofRequired: "Business registration, sales records — typically not disputed", classwide: true },
      { element: "Consumer suffered harm", description: "In NY/CA/IL: no individual reliance required — the deceptive act itself is the harm. Some states still require proof plaintiff saw and relied on the representation.", proofRequired: "Purchase records, price premium evidence (conjoint analysis)", classwide: true },
      { element: "Damages — price premium theory", description: "Plaintiff paid more for the product because of the false claim than they would have paid for the truthful product.", proofRequired: "Expert conjoint analysis survey quantifying price premium attributable to false claim. Critical under Comcast — damages model must match liability theory.", classwide: true },
    ],
    classActionViability: {
      rating: "A-",
      explanation: "Excellent class vehicle in no-reliance states (NY, CA, IL). The deception question is common, damages model is class-wide (price premium). Weakness: Comcast requires the price premium model to match the specific liability theory. If the model is overinclusive or based on different harm theory, class cert fails."
    },
    certificationPath: "Rule 23(b)(3) — common deception question + class-wide price premium damages model. Must pick governing state law carefully — NY GBL §349 is the gold standard for no-reliance consumer fraud.",
    sovereignImmunity: "Not applicable — private defendants.",
    typicalDamages: { perClaimant: "$10–$200 (economic loss / price premium)", aggregate: "$5M–$500M (high volume consumer products)" },
    daubert: "Expert needed for price premium damages (conjoint survey methodology). Must survive Daubert under Comcast — model must be tied specifically to defendant's false claim, not general brand value.",
    keyPrecedents: [
      "Comcast Corp. v. Behrend (2013) — damages model must match liability theory or class decertified",
      "In re ConAgra Wesson Oil (9th Cir. 2022) — $7.4M settlement; conjoint model survived",
      "Red Bull 'Gives You Wings' (2014) — $13M; no reliance required under NY GBL",
      "Subway Footlong (7th Cir. 2017) — VACATED; de minimis harm, no injury in fact",
    ],
    classificationSignals: ["False advertising", "misleading label", "deceptive marketing", "price premium claim", "product does not perform as advertised"],
    idealPlaintiffProfile: "Purchased the product multiple times in a state with no-reliance UDAP statute (NY, CA, IL). Can document purchases (credit card records, receipts). Believed the specific marketing claim at issue. Would have paid less or chosen a competing product absent the false claim.",
    redFlags: [
      "De minimis harm per claimant — court may find no injury in fact (Subway Footlong)",
      "Puffery defense — 'best,' 'premium,' 'superior' are legally non-actionable opinions",
      "Comcast problem — price premium model doesn't isolate the specific false claim",
      "Multi-state class requires choosing one state's law — choice of law challenges",
      "Cy pres challenges if recovery is too small to distribute meaningfully",
    ],
    timeToResolution: "1–4 years",
    feeStructure: "33% contingency; often negotiated as lodestar in small-recovery consumer cases",
    watchOut: "Before filing, commission a conjoint survey to validate there IS a measurable price premium. Without a defensible damages model, class cert fails under Comcast regardless of how strong the liability case is.",
  },

  // ─── SECURITIES ───────────────────────────────────────────────────────────

  {
    id: "securities-fraud-10b5",
    name: "Securities Fraud — §10(b) / Rule 10b-5",
    category: "Securities",
    overview: "Federal securities fraud under Section 10(b) of the Securities Exchange Act. Requires proof that a public company made a materially false statement in connection with the purchase or sale of securities, causing investor losses. The fraud-on-the-market presumption makes this one of the most class-certifiable claims.",
    elements: [
      { element: "Material misrepresentation or omission", description: "A false statement or omitted material fact that a reasonable investor would consider important in making an investment decision.", proofRequired: "SEC filings (10-K, 10-Q, 8-K), earnings calls, press releases — the false statement itself", classwide: true },
      { element: "Scienter (fraudulent intent or recklessness)", description: "Defendant made the false statement knowingly or with severe recklessness. The PSLRA requires specific facts supporting scienter at pleading stage.", proofRequired: "Internal emails, communications, whistleblower testimony, prior warnings ignored, stock sales by insiders shortly before disclosure", classwide: true },
      { element: "Connection with purchase or sale of securities", description: "The misstatement was made in connection with securities transactions.", proofRequired: "The public statement itself — typically a press release, SEC filing, or earnings call", classwide: true },
      { element: "Reliance — Fraud on the Market", description: "Under the fraud-on-the-market presumption (Basic v. Levinson), all investors who traded in an efficient market during the class period are presumed to have relied on the integrity of the market price, which reflected the false statement.", proofRequired: "Expert event study showing stock traded in efficient market; price impact of misstatement and corrective disclosure", classwide: true },
      { element: "Economic loss", description: "Plaintiff suffered a loss in the value of their securities.", proofRequired: "Stock price decline after corrective disclosure, loss causation expert", classwide: true },
      { element: "Loss causation", description: "The fraud (not other market factors) caused the stock price decline.", proofRequired: "Expert event study isolating the stock price decline attributable to the corrective disclosure vs. market-wide movements", classwide: true },
    ],
    classActionViability: {
      rating: "A+",
      explanation: "The gold standard for class certification. Fraud-on-the-market presumption makes reliance a class-wide question. Loss causation is quantifiable class-wide through event study. The PSLRA provides a specific procedural framework designed for class actions. Lead plaintiff must have the largest financial interest."
    },
    certificationPath: "Rule 23(b)(3) + PSLRA lead plaintiff process. Class period = from date of first false statement to date of corrective disclosure. All investors who bought stock during class period and held through corrective disclosure are class members.",
    sovereignImmunity: "Not applicable — publicly traded private companies. Exception: sovereign wealth funds may have defenses.",
    typicalDamages: { perClaimant: "$500–$50,000 depending on shares held", aggregate: "$50M–$10B for major corporate frauds" },
    daubert: "Event study expert is critical — must show efficient market, price impact of misstatement, and loss causation. Defense will challenge with Halliburton II price impact rebuttal.",
    keyPrecedents: [
      "Basic Inc. v. Levinson (1988) — fraud-on-the-market presumption established",
      "Halliburton Co. v. Erica P. John Fund (2014) — defendant can rebut presumption with price impact evidence at class cert",
      "Dura Pharmaceuticals v. Broudo (2005) — loss causation requires showing drop tied to corrective disclosure",
      "PSLRA (1995) — heightened pleading, lead plaintiff process, safe harbor for forward-looking statements",
    ],
    classificationSignals: ["SEC investigation", "restatement of earnings", "stock price drop after disclosure", "insider selling before announcement", "DOJ investigation of company", "CFO resigned", "accounting irregularities"],
    idealPlaintiffProfile: "Institutional investor (pension fund, mutual fund) with large losses — has resources to serve as lead plaintiff and fight through PSLRA process. Purchased shares during class period, held through corrective disclosure. Has strong documentation of all purchases and sales. Not a professional plaintiff (courts scrutinize frequent lead plaintiffs).",
    redFlags: [
      "Halliburton II — defendant can rebut fraud-on-the-market presumption if it proves no price impact at class cert",
      "PSLRA safe harbor protects forward-looking statements with cautionary language",
      "Short class period with small price drop = small damages = hard to fund litigation",
      "Scienter is notoriously hard to plead under PSLRA heightened standard",
      "Efficient market required — small cap or thinly traded stocks may not qualify",
    ],
    timeToResolution: "3–7 years",
    feeStructure: "25–33% contingency from common fund; PSLRA caps in some jurisdictions",
    watchOut: "The PSLRA was specifically designed to make securities class actions harder. You will face a motion to dismiss before any discovery. Need strong internal documents showing scienter to survive. The Halliburton II price impact attack at class cert is now standard — have your event study expert ready.",
  },

  // ─── CIVIL RIGHTS / GOVERNMENT LIABILITY ─────────────────────────────────

  {
    id: "section-1983",
    name: "§1983 Civil Rights — State Actor Violations",
    category: "Government Liability",
    overview: "42 U.S.C. §1983 creates a federal cause of action against any person who, acting under color of state law, deprives another of rights secured by the Constitution or federal law. The primary vehicle for suing state and local government officials and entities for civil rights violations. No sovereign immunity for prospective injunctive relief; qualified immunity protects individual officers unless right was 'clearly established.'",
    elements: [
      { element: "Person acting under color of state law", description: "Defendant was a state or local government official, employee, or private actor exercising governmental authority.", proofRequired: "Government employment records, official capacity documentation, state authority delegation", classwide: true },
      { element: "Deprivation of a constitutional or federal statutory right", description: "The specific constitutional right violated must be identified: 4th Amendment (unreasonable search/seizure), 8th Amendment (cruel and unusual punishment), 14th Amendment (due process, equal protection), 1st Amendment (free speech), etc.", proofRequired: "Evidence of the specific constitutional violation — varies by right at issue", classwide: false },
      { element: "Causation", description: "The defendant's conduct caused the constitutional deprivation.", proofRequired: "Direct link between defendant's action/policy and the harm", classwide: false },
      { element: "Damages", description: "Nominal, compensatory, and potentially punitive damages. Punitive not available against municipalities.", proofRequired: "Medical records, lost wages, emotional distress evidence", classwide: false },
      { element: "Monell liability (for municipalities)", description: "To sue a city or county (not just individual officers), must show: (1) official policy, (2) widespread custom/practice, or (3) failure to train — that was the moving force behind the violation.", proofRequired: "Pattern of prior incidents, internal policies, training records, DOJ investigation findings, statistical evidence of disparate impact", classwide: true },
    ],
    classActionViability: {
      rating: "B+",
      explanation: "Strong for systemic violations affecting a defined class (prison conditions, police pattern/practice, unconstitutional laws). Monell liability against a municipality requires showing a common policy or custom — this is the class-wide element. Individual damages remain individualized but can be handled through damages phases."
    },
    certificationPath: "Rule 23(b)(2) for injunctive/declaratory relief (prison reform, policy change) — no predominance requirement. Rule 23(b)(3) for damages. Often use (b)(2) first to get injunction, then damages in separate proceedings.",
    sovereignImmunity: "11th Amendment bars suits against STATES in federal court for money damages unless: (1) state waives immunity, (2) Congress abrogates (§5 of 14th Amendment), or (3) Ex Parte Young doctrine (prospective injunctive relief against state official). LOCAL governments (cities/counties) have NO 11th Amendment immunity — sue the municipality directly.",
    sovereignImmunityWorkaround: "For state money damages: file in state court OR seek Ex Parte Young injunction in federal court. For local government: sue municipality under Monell. For individual officers: qualified immunity defense — must show right was 'clearly established' in prior precedent.",
    typicalDamages: { perClaimant: "$5K–$500K (varies enormously by violation)", aggregate: "$10M–$1B for systemic institutional violations" },
    daubert: "Statistical expert often needed to establish pattern/practice (Monell element). Civil rights damages expert for emotional distress quantification.",
    keyPrecedents: [
      "Monell v. Dept. of Social Services (1978) — municipalities can be sued under §1983 for policies/customs",
      "Harlow v. Fitzgerald (1982) — qualified immunity standard ('clearly established' right)",
      "Brown v. Plata (2011) — prison overcrowding is 8th Amendment violation; SCOTUS ordered California to reduce prison population",
      "Pearson v. Callahan (2009) — courts can grant qualified immunity without ruling on underlying right",
    ],
    classificationSignals: ["Police misconduct pattern", "DOJ investigation of police department", "prison conditions lawsuit", "school district discrimination", "unconstitutional law enforcement", "systemic constitutional violation", "consent decree"],
    idealPlaintiffProfile: "Has documented, specific constitutional violation by identified government actor. Has medical or other objective evidence of harm (not solely emotional distress). Is not a repeat or professional plaintiff. For prison cases: currently incarcerated or recently released with documented pattern of harm. For police misconduct: video evidence or multiple witness corroboration greatly strengthens case.",
    redFlags: [
      "Qualified immunity — individual officers shielded unless prior case is nearly identical on the facts",
      "11th Amendment — cannot get money damages from state in federal court without workaround",
      "Monell requires proving policy/custom — anecdotes of individual officer misconduct are insufficient",
      "Short statute of limitations (often 2–3 years from accrual, varies by state)",
      "Individual issues in damages phase may prevent (b)(3) certification",
    ],
    timeToResolution: "3–8 years",
    feeStructure: "Civil Rights Attorney Fees Act (42 U.S.C. §1988) — fee-shifting, defendant pays reasonable attorney fees if plaintiff prevails. Contingency also common.",
    watchOut: "Qualified immunity is a massive barrier for individual officer suits. Focus on Monell liability against the municipality — this requires more work upfront (DOJ reports, pattern evidence) but is not subject to qualified immunity and opens the deep pocket (city/county insurance).",
  },

  {
    id: "ftca",
    name: "Federal Tort Claims Act (FTCA)",
    category: "Government Liability",
    overview: "28 U.S.C. §§1346(b), 2671-2680. The FTCA waives federal sovereign immunity for money damages caused by the negligent or wrongful acts of federal employees acting within the scope of their employment. The US government is liable in the same manner as a private person under the law of the state where the act occurred. Must file administrative claim first. Strict procedural requirements.",
    elements: [
      { element: "Federal employee or agency", description: "The tortfeasor was a federal government employee acting within the scope of employment (not an independent contractor).", proofRequired: "Employment records, scope of duty documentation, agency affiliation", classwide: true },
      { element: "Negligent or wrongful act or omission", description: "The federal employee acted negligently under the law of the state where the act occurred (state tort law applies).", proofRequired: "Expert testimony on applicable state standard of care, evidence of deviation", classwide: false },
      { element: "Causation and damages", description: "The negligence caused plaintiff's injury.", proofRequired: "Causal chain evidence, medical records, economic damages documentation", classwide: false },
      { element: "Administrative claim presentment", description: "Plaintiff must file an administrative claim with the relevant federal agency before filing suit. Must present a sum certain. Agency has 6 months to respond.", proofRequired: "SF-95 or equivalent administrative claim form, timely filing", classwide: false },
    ],
    classActionViability: {
      rating: "C+",
      explanation: "Class actions under FTCA are procedurally awkward because each plaintiff must exhaust administrative remedies (file individual administrative claims) before suit. This is a significant barrier to class certification. Better vehicle: Mass individual FTCA claims with coordinated litigation, or seek congressional relief (like Camp Lejeune PACT Act) to streamline the process."
    },
    certificationPath: "Individual FTCA claims are technically more common than class actions. For mass harm (Camp Lejeune, contaminated military bases), Congress sometimes creates special litigation pathways. Rule 23(b)(3) technically available but administrative exhaustion requirement is a major obstacle.",
    sovereignImmunity: "FTCA is the exception to sovereign immunity — it specifically waives immunity for listed acts. Key FTCA EXCEPTIONS (no waiver): discretionary function exception (policy decisions by government), combatant activities, foreign country exception. These exceptions swallow much of the FTCA.",
    sovereignImmunityWorkaround: "If FTCA exceptions apply: (1) Tucker Act for contract claims, (2) Congressional private bill, (3) specific Congressional waiver (PACT Act for Camp Lejeune), (4) state law claims against non-immune state actors.",
    typicalDamages: { perClaimant: "$50K–$5M (varies by injury; no punitive damages against government)", aggregate: "Varies widely; Camp Lejeune estimated $21B+ total" },
    daubert: "Same standard as private tort cases. State law applies for substantive liability.",
    keyPrecedents: [
      "Feres v. United States (1950) — active duty military CANNOT sue under FTCA for injuries incident to service",
      "United States v. Varig Airlines (1984) — discretionary function exception broadly interpreted",
      "Camp Lejeune Justice Act (PACT Act, 2022) — Congress created specific FTCA waiver for Camp Lejeune contamination",
      "Berkovitz v. United States (1988) — discretionary function test: (1) involves discretion, (2) based on policy considerations",
    ],
    classificationSignals: ["Federal government negligence", "VA hospital malpractice", "federal prison conditions", "contaminated military base", "federal agency negligent action", "Camp Lejeune", "government-caused environmental harm"],
    idealPlaintiffProfile: "Can identify specific federal employee (not independent contractor) who caused harm. Harm occurred on federal property or by clearly identified federal actor. Has preserved administrative claim filing deadline (2 years from accrual). No active military service exclusion (Feres doctrine).",
    redFlags: [
      "Feres doctrine bars all active duty military FTCA claims — massive limitation",
      "Discretionary function exception: any government action involving policy judgment is immune",
      "2-year statute of limitations runs from date of injury/discovery — administrative claim must be filed first",
      "Independent contractors (not federal employees) cannot trigger FTCA liability",
      "No punitive damages against the United States",
      "No jury trial — FTCA cases are tried to a judge only",
    ],
    timeToResolution: "5–15 years (government litigation is slow)",
    feeStructure: "Attorney fees capped at 25% of judgment/settlement under FTCA",
    watchOut: "The 2-year administrative claim deadline is a hard jurisdictional bar — missing it forfeits the entire claim. File the administrative claim (SF-95) immediately upon identifying FTCA liability, even if you are still investigating. You can always settle the admin claim later; you cannot recover a missed filing deadline.",
  },

  {
    id: "bivens",
    name: "Bivens Actions — Federal Officer Violations",
    category: "Government Liability",
    overview: "An implied federal cause of action against individual federal officers for constitutional violations. Created by SCOTUS in Bivens v. Six Unknown Fed. Narcotics Agents (1971). Now severely limited — SCOTUS has refused to extend Bivens beyond three original contexts and consistently rejects new Bivens claims. Effectively a dying doctrine.",
    elements: [
      { element: "Federal officer (not state, not municipality)", description: "Defendant is an individual federal employee — DEA agent, FBI agent, federal prison guard, etc. NOT the United States itself.", proofRequired: "Federal employment records, badge/credentials", classwide: false },
      { element: "Acting under color of federal law", description: "The officer was exercising federal authority when the violation occurred.", proofRequired: "Documentation of official capacity at time of incident", classwide: false },
      { element: "Violation of a constitutional right", description: "Specifically limited to: 4th Amendment (Bivens itself), 5th Amendment due process (Davis v. Passman), 8th Amendment (Carlson v. Green). SCOTUS has rejected every new context since 1980.", proofRequired: "Evidence of the specific constitutional violation", classwide: false },
      { element: "No adequate alternative remedy", description: "Courts look for any alternative remedy Congress provided — if one exists (even an imperfect one), Bivens is unavailable.", proofRequired: "This is a legal threshold question — no factual proof required", classwide: true },
    ],
    classActionViability: {
      rating: "D",
      explanation: "Bivens is nearly dead for class actions. SCOTUS in Egbert v. Boule (2022) signaled it would likely overrule Bivens entirely in the right case. The 'new context' analysis kills virtually every new Bivens claim. Use §1983 (for state actors), FTCA (for money damages from federal agency), or seek legislative remedy instead."
    },
    certificationPath: "Not recommended. Use alternative vehicles.",
    sovereignImmunity: "Bivens does NOT sue the United States — it sues individual officers personally. But qualified immunity still applies. The U.S. government will typically provide legal defense and may indemnify officers.",
    sovereignImmunityWorkaround: "File FTCA claim against the government in parallel. Seek Ex Parte Young injunctive relief against the federal official to halt ongoing violations. Push for Congressional remedy.",
    typicalDamages: { perClaimant: "Theoretically unlimited; practically very difficult to collect from individual federal officers", aggregate: "Rarely appropriate for class actions" },
    daubert: "N/A — threshold legal issues dominate before merits are reached.",
    keyPrecedents: [
      "Bivens v. Six Unknown Named Agents (1971) — original 4th Amendment claim against DEA agents",
      "Ziglar v. Abbasi (2017) — SCOTUS dramatically curtailed Bivens; any new context disfavored",
      "Egbert v. Boule (2022) — SCOTUS came within one vote of overruling Bivens entirely",
    ],
    classificationSignals: ["Federal officer misconduct", "FBI abuse", "DEA violation", "federal prison abuse", "border patrol constitutional violation"],
    idealPlaintiffProfile: "Claim fits squarely within one of the three original Bivens contexts (4th, 5th due process employment, 8th Amendment prison). All alternative remedies have been exhausted. Otherwise, redirect to FTCA or §1983.",
    redFlags: [
      "Any context outside the three original Bivens contexts — SCOTUS will likely dismiss",
      "If Congress has provided any alternative remedy (CSRA for federal employees, immigration statute, etc.), Bivens is barred",
      "Qualified immunity — same as §1983",
      "SCOTUS has signaled intention to overrule Bivens entirely",
    ],
    timeToResolution: "5–10 years with likely dismissal",
    feeStructure: "Same as §1983 — attorney fees under civil rights statutes if applicable",
    watchOut: "Do not build a practice around Bivens. It is a doctrinal dead end. For federal actor misconduct, the better vehicles are: FTCA (negligence/money damages), §1983 if there is state actor involvement, or advocacy for Congressional remedy.",
  },

  // ─── ENVIRONMENTAL ────────────────────────────────────────────────────────

  {
    id: "environmental-toxic-tort",
    name: "Environmental / Toxic Tort — CERCLA & Common Law",
    category: "Environmental",
    overview: "Claims arising from exposure to toxic substances (PFAS, lead, benzene, PCBs, asbestos) in soil, water, or air. Theories include negligence, strict liability (ultrahazardous activity), trespass, nuisance, and CERCLA cost recovery. Some of the largest MDLs in history (PFAS: $10.3B 3M settlement; Roundup: $11.6B Bayer settlement).",
    elements: [
      { element: "Defendant released hazardous substance", description: "Defendant owned, operated, or is responsible for the release of a toxic chemical into the environment.", proofRequired: "Environmental sampling data, EPA records, FOIA of agency files, satellite imagery, air/water monitoring data", classwide: true },
      { element: "Plaintiff was exposed to the substance", description: "Plaintiff had exposure to the toxic substance at levels sufficient to cause harm.", proofRequired: "Geographic proximity to contamination, biomonitoring (blood/urine levels), duration of exposure, environmental pathway analysis", classwide: false },
      { element: "General causation — substance can cause the injury", description: "The toxic substance is scientifically capable of causing the type of harm alleged. This is the Daubert battleground.", proofRequired: "Epidemiological studies, animal studies, mechanistic evidence, expert toxicologist, IARC classification, ATSDR toxicological profile", classwide: true },
      { element: "Specific causation — substance caused this plaintiff's injury", description: "This plaintiff's specific injury was caused by this exposure, not other factors.", proofRequired: "Medical records, differential diagnosis ruling out other causes, exposure level exceeding harmful threshold", classwide: false },
      { element: "Damages", description: "Physical injury (cancer, organ damage), property damage, diminution of property value, medical monitoring costs.", proofRequired: "Medical records, property appraisals, expert economist", classwide: false },
    ],
    classActionViability: {
      rating: "A-",
      explanation: "Strong for property damage and medical monitoring classes (exposure without current injury). More difficult for personal injury classes due to individual specific causation. PFAS water contamination has been highly successful because: uniform contamination source, defined geographic class, well-established science, large class size."
    },
    certificationPath: "Rule 23(b)(3) for property/economic damages. Rule 23(b)(2) for medical monitoring injunction. Medical monitoring classes (plaintiffs exposed but not yet injured) are particularly strong — injury is the monitoring itself, not a future illness.",
    sovereignImmunity: "CERCLA imposes strict liability on PRPs (potentially responsible parties) including private companies. For government-caused contamination (military bases, government facilities), FTCA applies with its exceptions.",
    typicalDamages: { perClaimant: "$10K–$300K (personal injury); $5K–$100K (property)", aggregate: "$500M–$10B+ for major contamination events (PFAS, asbestos)" },
    daubert: "Extremely important — general causation experts must survive rigorous Daubert scrutiny. Need: (1) peer-reviewed epidemiology, (2) dose-response relationship, (3) plausible biological mechanism, (4) consistent findings across studies. One failed Daubert motion can end the entire case.",
    keyPrecedents: [
      "In re PFAS Product Liability Litigation (MDL 2873) — $10.3B 3M settlement; $1.185B DuPont settlement",
      "In re Roundup Products Liability Litigation — $11.6B Bayer settlement",
      "Boomer v. Atlantic Cement (1970) — nuisance; ongoing pollution = damages not injunction",
      "Daubert v. Merrell Dow (1993) — trial judge as gatekeeper for expert testimony",
    ],
    classificationSignals: ["PFAS contamination", "toxic waste site", "groundwater contamination", "EPA Superfund", "benzene exposure", "lead paint", "asbestos", "industrial discharge", "military base contamination", "air quality violation"],
    idealPlaintiffProfile: "Lives or lived within the defined contamination zone for a documented period. Has elevated biomarker levels (blood PFAS, urine metals) or documented property value loss. Has a specific diagnosed injury (cancer, liver disease) with no obvious alternative cause. Has documentation of water source usage (utility bills, well records). Does NOT have occupational exposure that complicates attribution.",
    redFlags: [
      "Multiple exposure sources — specific causation nightmare (benzene from many sources)",
      "Long latency period (10–30 years for cancer) — causation science must cover historical exposure levels",
      "Scientific uncertainty about causation — Daubert is existential",
      "Property damage class may be decertified if individual property values vary widely",
      "CERCLA PRPs may argue divisibility of harm to limit liability",
    ],
    timeToResolution: "5–15 years for major environmental cases",
    feeStructure: "33–40% contingency; environmental cases often have common benefit fund",
    watchOut: "Geographic class definition is crucial — must be tight enough to show uniform exposure but broad enough to have sufficient class members. Commission professional environmental sampling and exposure modeling BEFORE filing. Never rely solely on government agency data which may be incomplete.",
  },

  // ─── DATA BREACH / PRIVACY ────────────────────────────────────────────────

  {
    id: "data-breach-privacy",
    name: "Data Breach / Privacy — Statutory and Common Law",
    category: "Privacy",
    overview: "Claims arising from unauthorized access to personal data. Range from statutory violations with per-person damages (BIPA: $1,000–$5,000/violation; TCPA: $500–$1,500/call) to common law negligence for data breaches. The most class-certifiable privacy claims are those with statutory damages — no actual harm required.",
    elements: [
      { element: "Defendant collected, stored, or processed plaintiff's personal data", description: "Defendant had custody of plaintiff's biometric identifiers, financial data, health data, or other PII.", proofRequired: "Defendant's own records, enrollment forms, privacy policy, data storage documentation", classwide: true },
      { element: "Statutory violation OR unauthorized disclosure/access", description: "BIPA: collected biometrics without written consent. TCPA: automated call without consent. CCPA: failure to honor opt-out. Data breach: unauthorized third-party access to PII.", proofRequired: "Lack of consent forms (BIPA), call records (TCPA), security incident report (breach), breach notification letters", classwide: true },
      { element: "Actual harm OR statutory damages (no harm required)", description: "For BIPA/TCPA: no actual harm required — statutory damages per violation. For common law breach: must show actual harm (financial loss, identity theft, time/money spent mitigating). This distinction determines class viability.", proofRequired: "Statutory: none required beyond the violation itself. Common law: fraud records, credit monitoring costs, time spent documenting", classwide: true },
      { element: "Class-wide uniformity of violation", description: "All class members were subject to the same policy, collection practice, or data handling failure.", proofRequired: "Defendant's uniform data collection policy, same software/system, common breach affecting all", classwide: true },
    ],
    classActionViability: {
      rating: "A+ (BIPA/TCPA statutory) / C+ (common law data breach)",
      explanation: "BIPA is the premier data privacy class action vehicle — no actual harm required, $1,000–$5,000 per violation, Illinois courts are plaintiff-friendly. TCPA similar. Common law data breach classes are much harder — courts increasingly require showing actual harm beyond the breach itself. Standing (TransUnion v. Ramirez, 2021) now bars many data breach classes."
    },
    certificationPath: "BIPA/TCPA: Rule 23(b)(3) — each class member has same statutory claim, same per-violation damages. Common law breach: Rule 23(b)(3) with actual harm showing — difficult post-TransUnion.",
    sovereignImmunity: "Not applicable — private defendants. Government data breaches: FTCA applies.",
    typicalDamages: { perClaimant: "BIPA: $1,000 (negligent) to $5,000 (intentional) per scan; TCPA: $500–$1,500/call; common law breach: $50–$500", aggregate: "BIPA cases: $100M–$650M (TikTok: $92M; Facebook: $650M); TCPA: $10M–$100M" },
    daubert: "Relatively light — damages in statutory cases are set by statute. Expert may be needed for common law breach to quantify actual harm or value of stolen data.",
    keyPrecedents: [
      "Rosenbach v. Six Flags (2019, IL) — BIPA does not require actual harm; violation itself is injury",
      "Facebook BIPA settlement (2021) — $650M for facial recognition without consent",
      "TransUnion LLC v. Ramirez (2021 SCOTUS) — every class member must have concrete injury for Article III standing; kills many data breach classes",
      "Van Patten v. Vertical Fitness (2017) — TCPA class cert; uniform calls without consent = common question",
    ],
    classificationSignals: ["Data breach notification", "biometric data collection", "facial recognition without consent", "robocalls without consent", "health data breach", "HIPAA violation", "unauthorized access to PII", "fingerprint scanning employees"],
    idealPlaintiffProfile: "BIPA: Illinois resident, enrolled in employer's biometric timekeeping system without signed written consent before enrollment, still employed or recently separated. TCPA: received automated calls or texts without prior express written consent; cell phone owner. Common law breach: victim of actual identity theft or fraud directly traceable to the breach, with documented financial losses.",
    redFlags: [
      "TransUnion standing problem: common law breach plaintiffs without actual harm may lack Article III standing",
      "BIPA 1-year limitations period for intentional claims (5-year for negligent) — strict timeliness required",
      "Aggregate damages so large they could destroy the company — courts use this to pressure low settlement",
      "BIPA exposure is existential for companies (thousands of employees × $1,000/scan = billions)",
      "Arbitration clauses in employment agreements or terms of service may block class",
    ],
    timeToResolution: "2–5 years",
    feeStructure: "33% contingency; TCPA cases often have fee awards under fee-shifting statutes",
    watchOut: "Post-TransUnion, always analyze Article III standing for every class member before filing a data breach class. If class members cannot show concrete harm, the class collapses. BIPA and TCPA avoid this problem because the statutory violation IS the concrete injury.",
  },

  // ─── EMPLOYMENT ──────────────────────────────────────────────────────────

  {
    id: "employment-flsa",
    name: "Employment — FLSA Wage & Hour Collective Action",
    category: "Employment",
    overview: "The Fair Labor Standards Act (29 U.S.C. §216(b)) provides a collective action mechanism (not Rule 23 class action) for unpaid wages, overtime, and minimum wage violations. Employees must affirmatively 'opt in' rather than opt out. Two-stage certification (conditional certification, then full certification after discovery) is more lenient than Rule 23.",
    elements: [
      { element: "Employer-employee relationship", description: "Plaintiff is a covered employee under FLSA — not an independent contractor (misclassification cases challenge this directly).", proofRequired: "Employment records, pay stubs, economic reality test factors (control, investment, integration, permanence)", classwide: true },
      { element: "Coverage under FLSA", description: "Employer engages in interstate commerce or enterprise with $500K+ annual revenue.", proofRequired: "Defendant's revenue records, interstate commerce activities — rarely contested for large employers", classwide: true },
      { element: "Violation — unpaid overtime, off-the-clock work, minimum wage, or tip theft", description: "Specific wage and hour violation. Most common: failure to pay overtime (1.5x) for hours over 40/week; off-the-clock work required; illegal tip pooling.", proofRequired: "Time records, pay stubs, employee declarations, supervisor testimony, company-wide timekeeping policy", classwide: true },
      { element: "Similarly situated employees", description: "The opt-in plaintiffs were all subject to the same unlawful policy or practice. This is the FLSA 'similarly situated' standard — more lenient than Rule 23 commonality.", proofRequired: "Company-wide policy documents, declarations from employees across locations, HR policies", classwide: true },
    ],
    classActionViability: {
      rating: "A",
      explanation: "FLSA collective actions are highly certifiable at the conditional stage. The 'similarly situated' standard is far more lenient than Rule 23. A single company-wide policy of not paying overtime or requiring off-the-clock work creates collective-wide liability. Warning: Epic Systems allows mandatory arbitration clauses with class waivers — check for arbitration agreements first."
    },
    certificationPath: "29 U.S.C. §216(b) two-stage certification: (1) conditional cert = lenient, need only 'substantial allegations' of similar situation; (2) final cert after discovery = more rigorous 'similarly situated' analysis. Parallel Rule 23 state wage/hour class often filed alongside FLSA collective.",
    sovereignImmunity: "Partial — FLSA covers state government employees. Federal employees: covered by different statutes.",
    typicalDamages: { perClaimant: "$500–$50,000 (back wages + liquidated damages)", aggregate: "$5M–$500M for large employer class" },
    daubert: "Expert economist typically needed for damages calculation across the class. Rarely a Daubert battleground in FLSA cases.",
    keyPrecedents: [
      "Epic Systems Corp. v. Lewis (2018 SCOTUS) — employers can require individual arbitration, waiving class/collective action rights",
      "Tyson Foods v. Bouaphakeo (2016) — representative evidence (sampling) can establish liability in FLSA collective",
      "Genesis HealthCare v. Symczyk (2013) — mootness of named plaintiff's claim does not automatically moot collective",
    ],
    classificationSignals: ["Wage theft", "unpaid overtime", "off-the-clock work", "misclassification as independent contractor", "tip theft", "minimum wage violation", "employee complaint to DOL", "DOL investigation"],
    idealPlaintiffProfile: "Current or former employee within 2 years (3 for willful violations). Has documentation of hours worked exceeding 40/week with no overtime pay — time records, emails showing work after hours, delivery records. NOT subject to valid individual arbitration agreement with class waiver. Multiple coworkers willing to join collective (strengthens 'similarly situated' showing).",
    redFlags: [
      "Mandatory arbitration clauses with class action waivers — Epic Systems makes these enforceable",
      "2-year statute (3 for willful) — opt-in plaintiffs' claims are only preserved from when they file consent",
      "Decertification risk after discovery if individual issues dominate (different managers, different policies at different locations)",
      "White-collar exemptions (executive, administrative, professional) may apply to higher-paid employees",
    ],
    timeToResolution: "2–5 years",
    feeStructure: "33% contingency; FLSA provides fee-shifting (defendant pays plaintiff's attorney fees if plaintiff prevails)",
    watchOut: "Check for arbitration agreements FIRST before taking FLSA clients. Epic Systems made individual arbitration agreements with class waivers almost universally enforceable. If the client signed one, you cannot bring a collective action — period.",
  },

  {
    id: "employment-title-vii",
    name: "Employment — Title VII / ADEA / ADA Discrimination Class",
    category: "Employment",
    overview: "Federal employment discrimination claims under Title VII (race, sex, religion, national origin), ADEA (age 40+), and ADA (disability). Class actions under Rule 23(b)(2) for injunctive relief and Rule 23(b)(3) for damages. Wal-Mart v. Dukes (2011) dramatically raised the commonality bar — must show a specific, uniform discriminatory policy or practice, not just statistical disparity.",
    elements: [
      { element: "Protected class membership", description: "Plaintiff is a member of a class protected by the applicable statute (race, sex, age 40+, disability, etc.).", proofRequired: "Plaintiff's own characteristics — self-evident or simple documentation", classwide: false },
      { element: "Adverse employment action", description: "Termination, demotion, failure to promote, unequal pay, hostile work environment.", proofRequired: "Employment records, performance reviews, pay records", classwide: false },
      { element: "Discriminatory motive — disparate treatment or disparate impact", description: "Disparate treatment: intentional discrimination. Disparate impact: neutral policy with disproportionate adverse effect on protected class. BOTH are valid theories.", proofRequired: "Disparate treatment: direct evidence OR statistical evidence + pretext. Disparate impact: statistical analysis showing adverse impact.", classwide: true },
      { element: "Commonality — same employment practice affecting all class members", description: "Post-Wal-Mart v. Dukes: must identify a SPECIFIC common policy or practice — not just managerial discretion or general culture of discrimination.", proofRequired: "Specific written policy, common algorithm, uniform testing requirement — not vague 'pay what the market bears' discretion", classwide: true },
    ],
    classActionViability: {
      rating: "B",
      explanation: "Post-Wal-Mart v. Dukes, this is significantly harder. The Supreme Court rejected the idea that a common culture of discrimination or broad managerial discretion satisfies Rule 23 commonality. Must find a specific, identifiable policy or practice. Disparate impact cases (e.g., biased hiring algorithm) are stronger than disparate treatment cases post-Dukes."
    },
    certificationPath: "Rule 23(b)(2) for injunctive relief (easiest — commonality lower bar). Rule 23(b)(3) for backpay and compensatory damages (requires Dukes commonality). EEOC charge exhaustion required before filing — must file EEOC charge first.",
    sovereignImmunity: "Title VII, ADEA, and ADA apply to state employers (Congress abrogated immunity under §5 of 14th Amendment for Title VII). Federal employees use separate procedures (EEOC administrative process + Title VII suit against agency head).",
    typicalDamages: { perClaimant: "$10K–$300K (back pay, front pay, compensatory, punitive)", aggregate: "$50M–$1B+ for large employer class" },
    daubert: "Statistical expert critical — must show adverse impact with statistical significance (at least 2-sigma). Defense statistician will attack sample size, comparator group, and methodology.",
    keyPrecedents: [
      "Wal-Mart Stores v. Dukes (2011 SCOTUS) — commonality requires 'glue' of specific common policy; general managerial discretion insufficient",
      "Griggs v. Duke Power Co. (1971) — disparate impact theory established",
      "Ledbetter v. Goodyear Tire (2007) — pay discrimination limitations period; overruled by Lilly Ledbetter Fair Pay Act (2009)",
    ],
    classificationSignals: ["Systematic pay gap", "biased hiring algorithm", "pattern of promotions favoring one group", "EEOC investigation of employer", "class action EEOC charge", "statistical discrimination evidence"],
    idealPlaintiffProfile: "Has filed EEOC charge (required before suit). Has specific documented instance of discrimination with objective evidence (passed over for promotion despite higher qualifications than promoted person, same job but lower pay than different-demographic colleague). Can connect their individual experience to a company-wide policy or practice — not just one bad manager.",
    redFlags: [
      "Wal-Mart v. Dukes: managerial discretion is NOT a common policy — must find specific identifiable discriminatory practice",
      "EEOC charge exhaustion required before suit — any claims not raised in EEOC charge may be barred",
      "300-day limitations period for filing EEOC charge (180 days in non-deferral states)",
      "Union employees may need to exhaust grievance procedures first",
      "Arbitration agreements increasingly common in employment contexts",
    ],
    timeToResolution: "4–8 years",
    feeStructure: "Fee-shifting under Title VII (defendant pays if plaintiff prevails); contingency also used",
    watchOut: "Wal-Mart v. Dukes changed everything. The old 'culture of discrimination' + statistical evidence approach no longer works. Before filing, identify the SPECIFIC common policy or practice — a biased algorithm, a specific quota system, a named discriminatory testing requirement. Statistical evidence alone is not enough.",
  },

  // ─── ANTITRUST ────────────────────────────────────────────────────────────

  {
    id: "antitrust-sherman-act",
    name: "Antitrust — Sherman Act §1 Price Fixing / Cartel",
    category: "Antitrust",
    overview: "Section 1 of the Sherman Act prohibits contracts, combinations, or conspiracies in restraint of trade. Price fixing among competitors is per se illegal — no need to prove market harm. Treble damages (3x actual damages) plus attorney fees make antitrust class actions among the most lucrative. Direct purchasers sue under Sherman Act; indirect purchasers use state antitrust laws (Illinois Brick workaround).",
    elements: [
      { element: "Agreement among competitors", description: "Two or more competing entities agreed — explicitly or implicitly — to fix prices, allocate markets, rig bids, or limit output.", proofRequired: "Direct evidence (emails, meeting records, guilty pleas in DOJ criminal case) OR circumstantial evidence (parallel pricing + plus factors: motive, opportunity, against independent interest)", classwide: true },
      { element: "Unreasonable restraint of trade (or per se illegal conduct)", description: "Price fixing, market allocation, and bid rigging are per se illegal — no market analysis needed. Other restraints analyzed under rule of reason.", proofRequired: "Per se: evidence of agreement alone. Rule of reason: market definition, market power, anticompetitive effects, lack of procompetitive justification.", classwide: true },
      { element: "Antitrust injury — plaintiff in the market, paid supracompetitive prices", description: "Plaintiff purchased in the affected market and paid more than they would have absent the conspiracy.", proofRequired: "Purchase records, expert economic analysis comparing actual prices to but-for competitive prices", classwide: true },
      { element: "Damages — overcharge amount", description: "The amount by which the cartel-inflated price exceeded the competitive price.", proofRequired: "Expert economist — regression analysis comparing affected market prices to unaffected comparison markets or pre/post-conspiracy periods", classwide: true },
    ],
    classActionViability: {
      rating: "A+",
      explanation: "Antitrust price-fixing classes are among the most certifiable because: conspiracy and overcharge questions are purely common; every class member paid the same inflated price; damages model (overcharge %) is class-wide. Comcast is less of a problem here because overcharge theory directly matches the price-fixing liability theory."
    },
    certificationPath: "Rule 23(b)(3) — overcharge question is common, damages model is class-wide. Direct purchaser class under Sherman Act federal law; indirect purchaser class under state antitrust statutes (Illinois Brick exception requires state law claims).",
    sovereignImmunity: "Not applicable — private companies. Government entities that fix prices may have immunity under state action doctrine.",
    typicalDamages: { perClaimant: "$100–$50,000 (overcharge amount × treble damages)", aggregate: "$500M–$50B+ (automotive parts cartel: $4B; LIBOR: $6B; benchmark interest rates: $2B+)" },
    daubert: "Economic expert critical for: (1) market definition, (2) demonstrating conspiracy inflated prices (regression analysis), (3) quantifying overcharge. Defense will attack methodology, comparison market selection, and but-for price model.",
    keyPrecedents: [
      "In re Automotive Parts Antitrust Litigation — $4B+ in settlements; price-fixing of auto parts",
      "In re Cathode Ray Tube (CRT) Antitrust Litigation — $543M; manufacturer cartel",
      "Illinois Brick v. Illinois (1977) — only DIRECT purchasers can sue under Sherman Act; indirect purchasers use state law",
      "Hanover Shoe v. United Shoe Machinery (1968) — pass-on defense rejected for direct purchasers",
    ],
    classificationSignals: ["DOJ criminal antitrust investigation", "guilty plea by company or executive", "cartel discovered", "price-fixing settlement", "price coordination among competitors", "bid rigging investigation", "market allocation agreement"],
    idealPlaintiffProfile: "Direct purchaser of the price-fixed product during the conspiracy period. Can document all purchases during class period (purchase orders, invoices). Has significant volume of purchases (higher damages). Business entity (not individual consumer) often has better documentation. Was forced to pay above-market prices and has comparator data.",
    redFlags: [
      "Illinois Brick: indirect purchasers (end consumers) cannot sue under federal Sherman Act — need state law parallel claims",
      "State action doctrine: government-regulated price coordination may be immune",
      "Passing on defense: defendants argue overcharge was passed through the supply chain, not paid by plaintiff",
      "Statute of limitations: 4 years from discovery; tolled during fraudulent concealment",
      "Foreign conduct: Sherman Act has limited extraterritorial reach (FTAIA)",
    ],
    timeToResolution: "5–10 years",
    feeStructure: "33% contingency from common fund; treble damages make attorney fees very large",
    watchOut: "Always check for a DOJ criminal investigation — guilty pleas create estoppel on conspiracy element, making class cert and summary judgment trivial. The civil class action should be filed quickly after a DOJ announcement to preserve the statute of limitations.",
  },

  // ─── INSURANCE / CONSUMER FINANCIAL ──────────────────────────────────────

  {
    id: "tcpa-fdcpa",
    name: "TCPA / FDCPA — Consumer Financial Protection",
    category: "Consumer Protection",
    overview: "The Telephone Consumer Protection Act (TCPA) and Fair Debt Collection Practices Act (FDCPA) are strict-liability consumer protection statutes with per-violation statutory damages — no actual harm required. Among the most prolific class action filings. TCPA: $500–$1,500 per unauthorized call/text. FDCPA: up to $1,000 per class member plus attorney fees.",
    elements: [
      { element: "TCPA — Defendant used ATDS or prerecorded voice", description: "TCPA prohibits calls/texts using an automatic telephone dialing system (ATDS) or prerecorded voice to cell phones without prior express written consent.", proofRequired: "Call records, dialing system documentation, expert telecommunications testimony on whether system qualifies as ATDS (post-Facebook v. Duguid, 2021 SCOTUS)", classwide: true },
      { element: "TCPA — No prior express written consent", description: "Plaintiff never consented (or revoked consent) to receive automated calls/texts.", proofRequired: "Absence of signed consent form, revocation communication, defendant's opt-in records", classwide: true },
      { element: "FDCPA — Communication by debt collector", description: "Defendant is a 'debt collector' under the Act (collecting debt on behalf of another) — NOT original creditors (they are exempt).", proofRequired: "Defendant's business model, contracts with creditors, nature of debt collection activity", classwide: true },
      { element: "FDCPA — Prohibited collection practice", description: "Defendant made false/misleading representations, used unfair practices, or failed to provide required validation notices.", proofRequired: "The collection letter or call itself — standardized letters sent to all class members = common question", classwide: true },
    ],
    classActionViability: {
      rating: "A (TCPA) / A (FDCPA form letter cases)",
      explanation: "Both statutes are designed for class actions — uniform conduct (same dialing system, same form letter) creates strong commonality. No actual harm required eliminates the post-TransUnion standing problem. FDCPA form letter cases where every class member received the identical improper letter are essentially automatic class cert."
    },
    certificationPath: "Rule 23(b)(3) — common system/form creates predominating common questions. FDCPA form letter cases: highest class cert rate in federal courts.",
    sovereignImmunity: "Not applicable — private debt collectors and telemarketers.",
    typicalDamages: { perClaimant: "TCPA: $500/call (negligent) to $1,500/call (willful); FDCPA: up to $1,000/class member", aggregate: "TCPA: $10M–$500M+; FDCPA: typically $500K–$50M" },
    daubert: "Telecommunications expert may be needed for TCPA ATDS determination. Minimal Daubert issues otherwise.",
    keyPrecedents: [
      "Facebook v. Duguid (2021 SCOTUS) — ATDS definition narrowed to systems using random/sequential number generators; limits some TCPA cases",
      "Spokeo v. Robins (2016 SCOTUS) — statutory violation alone may not give Article III standing; concrete harm needed (but per-violation statutes generally satisfy this)",
    ],
    classificationSignals: ["Robocall complaint", "spam text message", "TCPA lawsuit", "debt collection harassment", "form collection letter", "illegal debt collection practice", "CFPB complaint about calls"],
    idealPlaintiffProfile: "TCPA: Cell phone owner who received demonstrably automated calls or texts without clear prior consent. Has phone records showing calls. Did not provide consent in any form. FDCPA: Received uniform debt collection letter or call with specific FDCPA violation. Has the letter in hand. Multiple people received identical letter.",
    redFlags: [
      "Facebook v. Duguid narrowed ATDS definition — many predictive dialers may no longer qualify",
      "Revocation of consent must be clear and unambiguous — ambiguous revocation = no TCPA violation",
      "FDCPA only covers THIRD-PARTY debt collectors — original creditors are exempt",
      "1-year statute of limitations for FDCPA claims",
      "Aggregate damages so large they may trigger due process concerns (defendant faces bankruptcy from massive statutory damages)",
    ],
    timeToResolution: "1–4 years",
    feeStructure: "33% contingency; FDCPA provides mandatory fee-shifting (defendant pays if plaintiff prevails)",
    watchOut: "Facebook v. Duguid (2021) gutted many TCPA cases by narrowing the ATDS definition. Carefully analyze whether defendant's specific dialing system qualifies as an ATDS under the new standard before filing.",
  },

  // ─── FALSE CLAIMS ACT ─────────────────────────────────────────────────────

  {
    id: "false-claims-act",
    name: "False Claims Act — Qui Tam",
    category: "Government Fraud",
    overview: "31 U.S.C. §3729 et seq. Imposes treble damages and civil penalties on those who knowingly submit false claims to the federal government. The qui tam provision (§3730) allows private 'relators' (whistleblowers) to file suit on behalf of the government and receive 15–30% of any recovery. The most powerful whistleblower statute in US law. NOT a class action — individual relator suit — but produces massive recoveries.",
    elements: [
      { element: "Presentment of a false claim to the federal government", description: "Defendant submitted (or caused to be submitted) a claim for payment to the government that was false or fraudulent.", proofRequired: "The actual false claims submitted (Medicare billing records, defense contractor invoices, grant applications), expert testimony on billing standards", classwide: false },
      { element: "Knowledge — defendant knew claim was false", description: "Defendant had actual knowledge, deliberate ignorance, or reckless disregard of the falsity. No specific intent to defraud required.", proofRequired: "Internal emails, training records showing defendant knew proper standards, prior government notices of improper billing", classwide: false },
      { element: "Materiality", description: "The false statement had natural tendency to influence government's payment decision. Post-Universal Health Services v. US ex rel. Escobar (2016): must show government actually cares about compliance, not just technical violation.", proofRequired: "Government actually pays for this type of care/service; false certification was condition of payment", classwide: false },
      { element: "Damages — government overpayment", description: "Government paid money it would not have paid absent the fraud.", proofRequired: "Comparison of what was paid vs. what should have been paid; expert healthcare billing analyst", classwide: false },
    ],
    classActionViability: {
      rating: "N/A — Individual qui tam action, not a class action",
      explanation: "FCA is NOT a class action. It is an individual relator qui tam action. The relator (whistleblower) must have 'original source' knowledge — direct, independent, firsthand knowledge of the fraud. The government then decides whether to intervene and take over the case. Government intervention dramatically increases success rate."
    },
    certificationPath: "N/A — qui tam filed under seal in federal court. Government has 60 days to decide whether to intervene (in practice often takes years).",
    sovereignImmunity: "N/A — this IS the government suing on its own behalf through the relator mechanism.",
    typicalDamages: { perClaimant: "Relator receives 15–30% of total government recovery", aggregate: "FCA cases: $1M–$3B+ (Pfizer: $2.3B; HCA: $1.7B; Johnson & Johnson: $2.2B)" },
    daubert: "Healthcare expert witness critical for Medicare/Medicaid cases to establish proper billing standards.",
    keyPrecedents: [
      "Universal Health Services v. US ex rel. Escobar (2016) — implied certification theory; materiality standard",
      "US ex rel. Polansky v. Executive Health Resources (2023) — government can dismiss FCA cases even after declining to intervene",
    ],
    classificationSignals: ["Medicare/Medicaid billing fraud", "defense contractor overbilling", "healthcare upcoding", "kickbacks for referrals", "off-label drug promotion", "government contractor fraud", "pharma speaker bureau fraud"],
    idealPlaintiffProfile: "Current or former insider (employee, executive, billing specialist, physician) with direct, firsthand knowledge of the fraudulent scheme — not information from public sources. Has documentation (emails, invoices, internal reports). Has NOT already publicly disclosed the fraud (first-to-file rule bars later relators). Retained experienced qui tam counsel immediately upon discovering fraud.",
    redFlags: [
      "Public disclosure bar — if fraud was already publicly disclosed (news, SEC filings, FOIA), relator must be 'original source' to proceed",
      "First-to-file rule — only the first relator to file gets the bounty; subsequent filers are barred",
      "Escobar materiality: must show government would not have paid if it knew of the violation",
      "Retaliation risk — FCA provides anti-retaliation protection but whistleblowers still face career risk",
      "Government declining to intervene dramatically reduces odds of success",
    ],
    timeToResolution: "4–12 years",
    feeStructure: "Relator receives 15–25% if government intervenes; 25–30% if relator litigates alone",
    watchOut: "The FCA is NOT a class action and requires a REAL insider with firsthand knowledge. Do not file based on public information — the public disclosure bar will kill the case. Qui tam is the most powerful tool in the government fraud space but requires a legitimate insider whistleblower with original source knowledge.",
  },

  // ─── CONSTITUTIONAL TAKINGS ───────────────────────────────────────────────

  {
    id: "constitutional-takings",
    name: "Constitutional — Takings Clause (5th Amendment)",
    category: "Government Liability",
    overview: "The 5th Amendment provides that private property shall not be taken for public use without just compensation. Applies to physical takings (government occupies or destroys property) and regulatory takings (government regulation so burdens property that it effectively takes it). Also applies to states via 14th Amendment. Inverse condemnation = property owner sues government for compensation after taking.",
    elements: [
      { element: "Private property", description: "Plaintiff owns or holds a cognizable property interest — real property, personal property, vested contract rights, business goodwill (varies by jurisdiction).", proofRequired: "Deed, title, lease, contract, regulatory license or permit", classwide: false },
      { element: "Taking by government action", description: "Physical taking: government physically occupies or destroys property. Regulatory taking: government regulation denies all economically beneficial use (Lucas) OR regulation goes too far (Penn Central balancing test).", proofRequired: "Government action (statute, regulation, executive order); property value before and after government action; remaining beneficial use analysis", classwide: false },
      { element: "For public use", description: "The taking must serve a public purpose. Kelo v. City of New London (2005): economic development counts as 'public use' — broadly construed.", proofRequired: "Government's stated purpose — legal/political question, not factual", classwide: false },
      { element: "Just compensation not paid", description: "Plaintiff has not received fair market value for what was taken.", proofRequired: "Appraisals, comparable sales, economic expert testimony on fair market value", classwide: false },
    ],
    classActionViability: {
      rating: "B",
      explanation: "Takings class actions arise when government action uniformly harms a defined class of property owners — e.g., COVID eviction moratoriums affecting all landlords, government flooding of properties, regulatory taking of a specific type of business license. Property value analysis may be individual, but the government action (the taking itself) is common."
    },
    certificationPath: "Rule 23(b)(3) for compensation claims where common government action affected all class members. Tucker Act for federal takings (Court of Federal Claims has exclusive jurisdiction for claims > $10,000 against federal government).",
    sovereignImmunity: "The 5th Amendment ITSELF waives sovereign immunity for physical takings — the government must pay. Tucker Act (28 U.S.C. §1491) provides the vehicle for inverse condemnation suits against the federal government. State inverse condemnation claims in state courts.",
    typicalDamages: { perClaimant: "Fair market value of property taken or diminution in value", aggregate: "Varies widely — COVID moratorium cases: billions in theoretical exposure" },
    daubert: "Real estate appraiser expert needed to establish fair market value of taken property.",
    keyPrecedents: [
      "Kelo v. City of New London (2005 SCOTUS) — economic development is 'public use'; broad government power",
      "Lucas v. South Carolina Coastal Council (1992) — regulatory taking when ALL economic value destroyed",
      "Penn Central Transportation v. City of New York (1978) — balancing test for regulatory takings short of total deprivation",
      "Cedar Point Nursery v. Hassid (2021) — physical invasion of property even temporarily = per se taking",
      "Alabama Association of Realtors v. HHS (2021) — CDC eviction moratorium exceeded statutory authority (not a takings ruling but killed the moratorium)",
    ],
    classificationSignals: ["Government seizes property", "regulation destroys all property value", "government flooding or infrastructure damage to private property", "eviction moratorium compensation claims", "business license revoked", "government-mandated closure"],
    idealPlaintiffProfile: "Property owner (not renter) who held clear title during government action. Has before/after property appraisals showing diminution in value. Government action was specifically directed at plaintiff's property or class of properties (not general economic regulation affecting everyone equally). Has clear standing in Tucker Act venue for federal claims.",
    redFlags: [
      "Penn Central balancing test is defendant-friendly — most partial regulatory takings fail",
      "Government has very broad 'police power' to regulate without compensation (health, safety regulations not compensable)",
      "Tucker Act: all federal takings claims > $10K must be filed in Court of Federal Claims, not district court",
      "Statute of limitations: 6 years in Court of Federal Claims; varies by state for inverse condemnation",
    ],
    timeToResolution: "5–15 years",
    feeStructure: "33% contingency or hourly (Tucker Act cases often complex regulatory work)",
    watchOut: "Distinguish regulatory taking (must go through Penn Central or Lucas analysis — usually fails) from physical taking (strong case — Cedar Point). The government can regulate almost anything without compensation — only total destruction of value (Lucas) or physical occupation (Cedar Point) creates strong takings claims.",
  },

  // ─── RICO ─────────────────────────────────────────────────────────────────

  {
    id: "rico",
    name: "RICO — Racketeer Influenced and Corrupt Organizations",
    category: "Complex Litigation",
    overview: "18 U.S.C. §1962. Civil RICO provides treble damages and attorney fees for injuries to business or property caused by a pattern of racketeering activity. The 'nuclear weapon' of civil litigation — powerful but heavily misused. Courts are hostile to RICO in ordinary business/tort disputes. Best used for systematic fraud schemes (insurance fraud, pharmaceutical kickbacks, organized deception) with clear predicate acts.",
    elements: [
      { element: "Conduct", description: "Defendant participated in the conduct of an enterprise's affairs.", proofRequired: "Evidence of defendant's role in the enterprise — must be 'operation or management' of the enterprise (Reves v. Ernst & Young)", classwide: false },
      { element: "Enterprise", description: "An association-in-fact (informal group) or formal legal entity engaged in or affecting interstate commerce. Must be distinct from the 'person' committing the racketeering.", proofRequired: "Evidence of ongoing organization, common purpose, relationships among members", classwide: false },
      { element: "Pattern of racketeering activity", description: "At least two predicate acts (wire fraud, mail fraud, bank fraud, drug crimes, etc.) within 10 years that are related and continuous.", proofRequired: "Evidence of each predicate act (specific fraudulent communications, financial transactions); closed-ended or open-ended continuity", classwide: false },
      { element: "RICO injury — injury to business or property", description: "RICO does NOT cover personal injury. Plaintiff must have suffered concrete injury to their business or property — financial loss from the predicate acts.", proofRequired: "Financial records showing losses, expert economic analysis of damages from the racketeering scheme", classwide: false },
      { element: "Proximate causation", description: "The RICO violation was the proximate cause of plaintiff's injury — no intervening independent cause.", proofRequired: "Direct causal chain from predicate acts to plaintiff's financial loss", classwide: false },
    ],
    classActionViability: {
      rating: "B-",
      explanation: "Civil RICO class actions are possible but courts are hostile. Best cases: systematic mail/wire fraud scheme affecting all class members identically (same form letters, same fraudulent scheme). Worst cases: RICO as a 'litigation tax' on ordinary business disputes — courts dismiss these quickly. Class-wide injury and causation from the common enterprise scheme can satisfy Rule 23."
    },
    certificationPath: "Rule 23(b)(3) — common RICO scheme = common questions if plaintiff can show each class member was defrauded by the same fraudulent communications. Holmes v. Securities Investor Protection Corp. must show proximate cause for each class member.",
    sovereignImmunity: "Not applicable — RICO targets private enterprises. Government entities are not 'enterprises' under RICO.",
    typicalDamages: { perClaimant: "TREBLE damages — 3x actual damages + attorney fees. Very powerful if actual losses are significant.", aggregate: "Varies widely — RICO trebling makes even modest actual losses into large claims" },
    daubert: "Expert needed to trace RICO scheme proceeds and quantify damages.",
    keyPrecedents: [
      "H.J. Inc. v. Northwestern Bell Telephone (1989) — 'pattern' requires continuity + relationship; open-ended or closed-ended",
      "Reves v. Ernst & Young (1993) — must be 'operation or management' of enterprise to be liable",
      "Bridge v. Phoenix Bond & Indemnity Co. (2008) — first-party reliance not required in civil RICO mail fraud",
    ],
    classificationSignals: ["Organized fraud scheme", "systematic deception", "insurance fraud ring", "pharmaceutical kickback scheme", "organized crime involvement in legitimate business", "multiple states fraudulent scheme"],
    idealPlaintiffProfile: "Suffered concrete financial loss (not personal injury) directly traceable to specific fraudulent communications (mail or wire fraud) sent by defendant's organized enterprise. Multiple plaintiffs received identical fraudulent communications in a scheme-wide pattern. Can identify the 'enterprise' participants and their roles.",
    redFlags: [
      "RICO does NOT cover personal injury — only injury to 'business or property'",
      "Courts dismiss 'garden variety fraud' as RICO — must show organized criminal-style enterprise, not just a business dispute",
      "Pattern requirement: single fraudulent scheme may not constitute 'pattern' (requires closed- or open-ended continuity)",
      "Proximate cause: indirect victims (plaintiffs who lost money because a third party was defrauded) generally cannot sue",
      "Statute of limitations: 4 years from discovery of injury",
    ],
    timeToResolution: "5–10 years",
    feeStructure: "33% contingency — RICO attorney fees are mandatory if plaintiff prevails",
    watchOut: "Courts have developed strong reflexes against RICO in commercial disputes. If the claim can be brought as simple fraud or breach of contract, file that. RICO should be reserved for cases with a genuine organized scheme, clear predicate acts, and concrete financial injury. The treble damages are powerful but getting there requires surviving a hostile judiciary.",
  },

];

// ─── LOOKUP HELPERS ───────────────────────────────────────────────────────────

export const CA_BY_ID = Object.fromEntries(CAUSES_OF_ACTION.map(ca => [ca.id, ca]));

export const CA_CATEGORIES = [...new Set(CAUSES_OF_ACTION.map(ca => ca.category))];

export const CA_BY_CATEGORY = CA_CATEGORIES.reduce((acc, cat) => {
  acc[cat] = CAUSES_OF_ACTION.filter(ca => ca.category === cat);
  return acc;
}, {});

// Maps case type labels (from KB / Scanner) to CA IDs
export const CASE_TYPE_TO_CA = {
  "Medical Device":      ["product-strict-liability", "product-negligence"],
  "Pharmaceutical":      ["product-strict-liability", "product-negligence"],
  "Auto Defect":         ["product-strict-liability", "product-negligence"],
  "Consumer Fraud":      ["consumer-protection-udap", "tcpa-fdcpa"],
  "Securities":          ["securities-fraud-10b5", "rico"],
  "Environmental":       ["environmental-toxic-tort", "constitutional-takings"],
  "Data Breach":         ["data-breach-privacy", "tcpa-fdcpa"],
  "Employment":          ["employment-flsa", "employment-title-vii"],
  "Antitrust":           ["antitrust-sherman-act", "rico"],
  "Financial Products":  ["consumer-protection-udap", "rico", "tcpa-fdcpa"],
  "Food Safety":         ["product-strict-liability", "consumer-protection-udap"],
  "Government Liability":["section-1983", "ftca", "constitutional-takings"],
};
