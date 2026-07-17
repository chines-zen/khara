import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================================
// MOCK DATA (from src/lib/opportunities.ts)
// ============================================================================

const STAGES = [
  "Prospecting",
  "Qualification",
  "Proposal",
  "Negotiation",
  "Closed Won",
  "Closed Lost",
];

const OWNERS = [
  "Sarah Jenkins",
  "Marcus Thorne",
  "David Kim",
  "Elena Rodriguez",
  "Priya Patel",
];

const OPPORTUNITIES = [
  {
    id: "OPP-94821",
    name: "Acme Global Expansion",
    account: "Acme Corp",
    stage: "Negotiation",
    amount: 142000,
    closeDate: "2026-07-12",
    owner: "Sarah Jenkins",
    scNotes:
      "Technical validation complete. Customer requested a custom integration with their legacy ERP. We have a clear path to MVP but need to confirm resource availability for Q3 implementation.",
    nextSteps: ["Send updated MSA to Legal", "Schedule sync with Product (ERP API)"],
    managerNotes:
      "Sarah has strong champion support in the CTO office. Probability is high if we can handle the compliance review by month end.",
    scManagerNotes:
      "Ensure the implementation costs are fully loaded in the proposal. Don't discount service hours on this one.",
    dScore: 82,
    recentDScoreDate: "2026-05-12",
    dScoreDelta: 5,
  },
  {
    id: "OPP-94822",
    name: "Nebula Data Platform",
    account: "Nebula Systems",
    stage: "Proposal",
    amount: 64500,
    closeDate: "2026-08-01",
    owner: "Marcus Thorne",
    scNotes:
      "POC delivered successfully across 3 data sources. Buying committee aligned on the technical fit; pricing review is the remaining blocker.",
    nextSteps: ["Deliver final pricing sheet", "Confirm SOC2 documentation"],
    managerNotes: "Watch for procurement delay — they have a 6-week vendor onboarding cycle.",
    scManagerNotes: "Bundle the migration services to justify list pricing.",
    dScore: 58,
    recentDScoreDate: "2026-05-18",
    dScoreDelta: -2,
  },
  {
    id: "OPP-94823",
    name: "CloudScale Renewal+",
    account: "CloudScale Corp",
    stage: "Qualification",
    amount: 210000,
    closeDate: "2026-06-22",
    owner: "Sarah Jenkins",
    scNotes: "Renewal at risk. Champion left the org last month; need to re-establish executive sponsor.",
    nextSteps: ["Map new buying committee", "Request exec sponsor intro"],
    managerNotes: "Escalate to VP if no exec contact secured within 2 weeks.",
    scManagerNotes: "Treat as new logo motion until we re-anchor the relationship.",
    dScore: 34,
    recentDScoreDate: "2026-05-20",
    dScoreDelta: -12,
  },
  {
    id: "OPP-94824",
    name: "Ironwood Fleet Telemetry",
    account: "Ironwood Logistics",
    stage: "Closed Won",
    amount: 12000,
    closeDate: "2026-04-20",
    owner: "David Kim",
    scNotes: "Pilot signed. Limited scope, but a strong reference customer for the logistics vertical.",
    nextSteps: ["Kickoff scheduled for May 1", "Loop in CSM"],
    managerNotes: "Strong foothold — line up expansion conversation in Q4.",
    scManagerNotes: "Document the integration patterns for reuse.",
    dScore: 74,
    recentDScoreDate: "2026-04-22",
    dScoreDelta: 3,
  },
  {
    id: "OPP-94825",
    name: "Stellar Analytics Tier 2",
    account: "Stellar Tech",
    stage: "Proposal",
    amount: 89000,
    closeDate: "2026-09-10",
    owner: "Sarah Jenkins",
    scNotes: "Evaluating us against two competitors. Differentiation is governance + audit features.",
    nextSteps: ["Run governance demo", "Share Forrester comparison brief"],
    managerNotes: "Decision committee meets June 15.",
    scManagerNotes: "Push for a paid POC to lock out competitors.",
    dScore: 42,
    recentDScoreDate: "2026-05-15",
    dScoreDelta: 0,
  },
  {
    id: "OPP-94826",
    name: "FinStream Compliance Module",
    account: "FinStream Inc",
    stage: "Negotiation",
    amount: 15500,
    closeDate: "2026-06-05",
    owner: "Marcus Thorne",
    scNotes: "Down to redlines. Legal review on indemnification clauses.",
    nextSteps: ["Legal response by EOW", "Confirm start date"],
    managerNotes: "Small ticket but strategic — first finance vertical win.",
    scManagerNotes: "Hold the line on uptime SLA wording.",
    dScore: 91,
    recentDScoreDate: "2026-05-22",
    dScoreDelta: 4,
  },
  {
    id: "OPP-94827",
    name: "Vertex Media Migration",
    account: "Vertex Media",
    stage: "Qualification",
    amount: 45000,
    closeDate: "2026-08-18",
    owner: "Priya Patel",
    scNotes: "Discovery complete. Migrating off a homegrown system; scope is well defined.",
    nextSteps: ["Send architecture diagram", "Schedule security review"],
    managerNotes: "Champion is the new VP Eng — strong relationship signal.",
    scManagerNotes: "Standard migration package should fit.",
    dScore: 68,
    recentDScoreDate: "2026-05-19",
    dScoreDelta: 6,
  },
  {
    id: "OPP-94828",
    name: "Capital Bank Security Suite",
    account: "Capital Bank",
    stage: "Proposal",
    amount: 310000,
    closeDate: "2026-10-01",
    owner: "Elena Rodriguez",
    scNotes: "Large deal. Multiple stakeholders across InfoSec, IT, and Risk. Procurement-driven.",
    nextSteps: ["Submit RFP response", "Schedule InfoSec deep dive"],
    managerNotes: "Forecast as commit only after RFP scoring.",
    scManagerNotes: "Bring solutions architect to InfoSec session.",
    dScore: 47,
    recentDScoreDate: "2026-05-21",
    dScoreDelta: 2,
  },
  {
    id: "OPP-94829",
    name: "Skyline Cloud Native Upgrade",
    account: "Skyline Dev",
    stage: "Negotiation",
    amount: 140000,
    closeDate: "2026-06-30",
    owner: "David Kim",
    scNotes: "Strong technical fit. Pricing approved internally. Awaiting customer board sign-off.",
    nextSteps: ["Confirm board outcome", "Prep onboarding plan"],
    managerNotes: "High confidence close this quarter.",
    scManagerNotes: "Pre-stage CSM for fast handoff.",
    dScore: 92,
    recentDScoreDate: "2026-05-23",
    dScoreDelta: 1,
  },
  {
    id: "OPP-94830",
    name: "Bloom Marketing Automations",
    account: "Bloom Agency",
    stage: "Closed Won",
    amount: 55000,
    closeDate: "2026-03-15",
    owner: "Priya Patel",
    scNotes: "Closed Q1. Expansion conversation already in motion for additional seats.",
    nextSteps: ["Schedule QBR", "Identify expansion sponsor"],
    managerNotes: "Reference candidate for marketing vertical.",
    scManagerNotes: "Capture case study within 60 days.",
    dScore: 98,
    recentDScoreDate: "2026-04-01",
    dScoreDelta: 0,
  },
  {
    id: "OPP-94831",
    name: "Local Threads Pilot",
    account: "Local Threads",
    stage: "Closed Lost",
    amount: 12500,
    closeDate: "2026-02-28",
    owner: "Marcus Thorne",
    scNotes: "Budget pulled mid-cycle. Champion remains warm; revisit Q4.",
    nextSteps: ["Quarterly check-in scheduled", "Send relevant case study"],
    managerNotes: "Move to nurture. Not a fit until they raise next round.",
    scManagerNotes: "Tag for nurture; revisit FY27.",
    dScore: 8,
    recentDScoreDate: "2026-03-01",
    dScoreDelta: -20,
  },
  {
    id: "OPP-94832",
    name: "Maersk Logistics Expansion",
    account: "Maersk Group",
    stage: "Prospecting",
    amount: 85000,
    closeDate: "2026-11-15",
    owner: "David Kim",
    scNotes: "Early-stage. Inbound lead from website demo. Discovery scheduled.",
    nextSteps: ["Run discovery call", "Qualify budget and authority"],
    managerNotes: "Don't over-invest until qualification confirms fit.",
    scManagerNotes: "Standard discovery deck — no SC time yet.",
    dScore: 32,
    recentDScoreDate: "2026-05-10",
    dScoreDelta: 0,
  },
  {
    id: "OPP-94833",
    name: "FinTech Platform Migration",
    account: "FinTech Solutions",
    stage: "Prospecting",
    amount: 120000,
    closeDate: "2026-10-20",
    owner: "Elena Rodriguez",
    scNotes: "Outbound-sourced. CTO is engaged; aligning on evaluation criteria.",
    nextSteps: ["Send evaluation framework", "Confirm POC scope"],
    managerNotes: "Promising. Allocate SC after POC scope confirmed.",
    scManagerNotes: "Cap POC at 3 weeks.",
    dScore: 55,
    recentDScoreDate: "2026-05-17",
    dScoreDelta: 5,
  },
  {
    id: "OPP-94834",
    name: "Atlas Insurance Underwriting",
    account: "Atlas Insurance",
    stage: "Qualification",
    amount: 178000,
    closeDate: "2026-09-25",
    owner: "Elena Rodriguez",
    scNotes: "Complex compliance landscape. Need to validate data residency requirements.",
    nextSteps: ["Confirm data residency", "Schedule compliance Q&A"],
    managerNotes: "Strategic deal for insurance vertical entry.",
    scManagerNotes: "Loop in compliance SME for next call.",
    dScore: 61,
    recentDScoreDate: "2026-05-20",
    dScoreDelta: 3,
  },
  {
    id: "OPP-94835",
    name: "Helix Bio Research Suite",
    account: "Helix Biotech",
    stage: "Proposal",
    amount: 96000,
    closeDate: "2026-07-30",
    owner: "Priya Patel",
    scNotes: "Custom research workflow validated. Awaiting procurement engagement.",
    nextSteps: ["Procurement intake form", "Confirm fiscal calendar"],
    managerNotes: "Fiscal year ends Sept — push to close before then.",
    scManagerNotes: "Offer Q3 incentive if needed to accelerate.",
    dScore: 70,
    recentDScoreDate: "2026-05-19",
    dScoreDelta: 2,
  },
  {
    id: "OPP-94836",
    name: "Northwind ERP Connector",
    account: "Northwind Traders",
    stage: "Negotiation",
    amount: 38000,
    closeDate: "2026-06-10",
    owner: "Marcus Thorne",
    scNotes: "Standard connector deal. Contract review in legal.",
    nextSteps: ["Resolve auto-renewal clause"],
    managerNotes: "Likely close this month.",
    scManagerNotes: "Standard terms acceptable.",
    dScore: 84,
    recentDScoreDate: "2026-05-21",
    dScoreDelta: 1,
  },
  {
    id: "OPP-94837",
    name: "Quantum Labs Platform",
    account: "Quantum Labs",
    stage: "Closed Lost",
    amount: 220000,
    closeDate: "2026-04-05",
    owner: "Sarah Jenkins",
    scNotes: "Lost to incumbent. Price was not the issue — switching costs were too high.",
    nextSteps: ["Schedule 6-month revisit"],
    managerNotes: "Good qualification despite the loss. Document learnings.",
    scManagerNotes: "Brief the team on the incumbent's stickiness factors.",
    dScore: 12,
    recentDScoreDate: "2026-04-06",
    dScoreDelta: -30,
  },
  {
    id: "OPP-94838",
    name: "Pioneer Health Records",
    account: "Pioneer Health",
    stage: "Qualification",
    amount: 265000,
    closeDate: "2026-12-01",
    owner: "Elena Rodriguez",
    scNotes: "HIPAA workflow review in progress. Long sales cycle expected.",
    nextSteps: ["Sign BAA", "Map compliance gap list"],
    managerNotes: "Forecast for next quarter, not this one.",
    scManagerNotes: "Pull in compliance team weekly.",
    dScore: 52,
    recentDScoreDate: "2026-05-18",
    dScoreDelta: 4,
  },
  {
    id: "OPP-94839",
    name: "Beacon Education Rollout",
    account: "Beacon Education",
    stage: "Prospecting",
    amount: 41000,
    closeDate: "2026-08-25",
    owner: "Priya Patel",
    scNotes: "Education vertical pilot. Budget unconfirmed.",
    nextSteps: ["Confirm fiscal availability", "Run product overview"],
    managerNotes: "Education deals tend to slip — set conservative date.",
    scManagerNotes: "Reuse education vertical demo.",
    dScore: 38,
    recentDScoreDate: "2026-05-14",
    dScoreDelta: 1,
  },
  {
    id: "OPP-94840",
    name: "Granite Manufacturing IoT",
    account: "Granite Manufacturing",
    stage: "Proposal",
    amount: 132000,
    closeDate: "2026-09-05",
    owner: "David Kim",
    scNotes: "On-prem deployment. Proposal includes managed services line.",
    nextSteps: ["Confirm on-prem hardware list", "Schedule install planning call"],
    managerNotes: "Margin is thin — verify services pricing.",
    scManagerNotes: "Loop in deployment lead before final pricing.",
    dScore: 66,
    recentDScoreDate: "2026-05-22",
    dScoreDelta: 2,
  },
];

// ============================================================================
// FILTERING LOGIC
// ============================================================================

function applyFilters(filters = {}) {
  const { search, stages, owner, closeMonths, daysSinceMax, arrMin } = filters;
  const searchLower = (search || '').trim().toLowerCase();
  const now = Date.now();

  return OPPORTUNITIES.filter((opp) => {
    // Search filter
    if (searchLower && !`${opp.name} ${opp.account} ${opp.owner}`.toLowerCase().includes(searchLower)) {
      return false;
    }

    // Stage filter
    if (stages && stages.length > 0 && !stages.includes(opp.stage)) {
      return false;
    }

    // Owner filter
    if (owner && opp.owner !== owner) {
      return false;
    }

    // Close month filter
    if (closeMonths && closeMonths.length > 0) {
      const monthKey = opp.closeDate.slice(0, 7); // yyyy-mm
      if (!closeMonths.includes(monthKey)) {
        return false;
      }
    }

    // Days since filter
    if (daysSinceMax !== null && daysSinceMax !== undefined && !isNaN(daysSinceMax)) {
      const days = Math.floor((now - new Date(opp.recentDScoreDate).getTime()) / 86400000);
      if (days > daysSinceMax) {
        return false;
      }
    }

    // ARR Minimum filter
    if (arrMin !== null && arrMin !== undefined && !isNaN(arrMin)) {
      if (opp.amount < arrMin) {
        return false;
      }
    }

    return true;
  });
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

// POST /api/opportunities - Get filtered opportunities
app.post('/api/opportunities', (req, res) => {
  try {
    const filters = req.body;
    const filtered = applyFilters(filters);
    res.json(filtered);
  } catch (error) {
    console.error('Error filtering opportunities:', error);
    res.status(500).json({ error: 'Failed to fetch opportunities' });
  }
});

// GET /api/owners - Get unique owners
app.get('/api/owners', (req, res) => {
  try {
    const uniqueOwners = [...new Set(OPPORTUNITIES.map((opp) => opp.owner))].sort();
    res.json(uniqueOwners);
  } catch (error) {
    console.error('Error fetching owners:', error);
    res.status(500).json({ error: 'Failed to fetch owners' });
  }
});

// GET /api/close-months - Get available close months
app.get('/api/close-months', (req, res) => {
  try {
    const months = [...new Set(OPPORTUNITIES.map((opp) => opp.closeDate.slice(0, 7)))].sort().reverse();
    res.json(months);
  } catch (error) {
    console.error('Error fetching close months:', error);
    res.status(500).json({ error: 'Failed to fetch close months' });
  }
});

// GET /api/health - Health check (mock data version)
app.get('/api/health', (req, res) => {
  try {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      latency: 5,
      message: 'Mock data mode - no Snowflake connection',
      mockData: true,
    });
  } catch (error) {
    console.error('Error in health check:', error);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      message: 'Health check failed',
    });
  }
});

// GET /api/stats - Get database statistics
app.get('/api/stats', (req, res) => {
  try {
    // Count by stage
    const byStage = {};
    OPPORTUNITIES.forEach((opp) => {
      byStage[opp.stage] = (byStage[opp.stage] || 0) + 1;
    });

    // Count by owner
    const byOwner = {};
    OPPORTUNITIES.forEach((opp) => {
      byOwner[opp.owner] = (byOwner[opp.owner] || 0) + 1;
    });

    // Total pipeline value
    const totalPipelineValue = OPPORTUNITIES.reduce((sum, opp) => sum + opp.amount, 0);

    res.json({
      totalOpportunities: OPPORTUNITIES.length,
      byStage: Object.entries(byStage).map(([stage, count]) => ({ stage, count })),
      byOwner: Object.entries(byOwner).map(([owner, count]) => ({ owner, count })),
      totalPipelineValue,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// ============================================================================
// STATIC FILE SERVING
// ============================================================================

// Serve static files from dist directory
app.use(express.static(path.join(__dirname, 'dist')));

// Serve index.html for all other routes (client-side routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log(`✅ SE Opp Rigor server running on port ${PORT}`);
  console.log(`📊 Mock data mode: ${OPPORTUNITIES.length} opportunities loaded`);
  console.log(`🌐 Open http://localhost:${PORT} in your browser`);
});
