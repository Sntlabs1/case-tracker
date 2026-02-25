/clea# Class Action & MDL Analysis Dashboard

A plaintiff intelligence platform for identifying, tracking, and analyzing potential class action lawsuits and multidistrict litigation (MDL) cases.

## Features

- **Dashboard** — At-a-glance stats, top cases by viability score, case pipeline visualization
- **Case Tracker** — Full case management with filtering, priority/status tracking, and inline editing
- **Source Monitor** — 22+ recall and litigation sources organized by category with direct links
- **AI Scanner** — Web search-powered discovery of latest recalls, class actions, and MDL developments
- **AI Case Analysis** — Per-case viability assessment, client acquisition strategy, and legal research briefs

## Data Sources Monitored

| Category | Sources |
|---|---|
| Federal | FDA Recalls, CPSC, NHTSA, FSIS, EPA, SEC, CFPB, FTC |
| Medical | FDA MAUDE, FDA FAERS, CDC VAERS, ClinicalTrials.gov |
| Judicial | JPML MDL Panel, Stanford Securities Class Action Clearinghouse |
| News | Fox Business Recalls, PR Newswire |
| Plaintiff Intel | ClassAction.org, TopClassActions, AboutLawsuits |
| State | NY DOS, CA Attorney General |
| Consumer | BBB Complaints |

## Setup

```bash
# Clone the repo
git clone https://github.com/Sntlabs1/case-tracker.git
cd case-tracker

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Project Structure

```
case-tracker/
├── index.html          # Entry HTML
├── package.json        # Dependencies & scripts
├── vite.config.js      # Vite configuration
├── .gitignore
├── README.md
└── src/
    ├── main.jsx        # React entry point
    └── App.jsx         # Main application component
```

## Tech Stack

- React 18
- Vite 5
- Anthropic Claude API (AI analysis features)

## Deployment

This app can be deployed to Vercel, Netlify, or any static hosting:

```bash
npm run build
# Deploy the `dist/` folder
```

## License

Private — Sntlabs1
