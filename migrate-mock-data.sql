-- Migration script to load the mock data into Snowflake
-- This populates the opportunities table with all the sample data from the prototype

-- Ensure we're in the right context
USE DATABASE SE_OPP_RIGOR;
USE SCHEMA PUBLIC;

-- Insert all mock opportunities
INSERT INTO opportunities (
    id, name, account, stage, amount, close_date, owner,
    sc_notes, next_steps, manager_notes, sc_manager_notes,
    d_score, recent_d_score_date, d_score_delta
) VALUES
-- OPP-94821: Acme Global Expansion
('OPP-94821', 'Acme Global Expansion', 'Acme Corp', 'Negotiation', 142000.00, '2026-07-12', 'Sarah Jenkins',
 'Technical validation complete. Customer requested a custom integration with their legacy ERP. We have a clear path to MVP but need to confirm resource availability for Q3 implementation.',
 PARSE_JSON('["Send updated MSA to Legal", "Schedule sync with Product (ERP API)"]'),
 'Sarah has strong champion support in the CTO office. Probability is high if we can handle the compliance review by month end.',
 'Ensure the implementation costs are fully loaded in the proposal. Don''t discount service hours on this one.',
 82.00, '2026-05-12', 5.00),

-- OPP-94822: Nebula Data Platform
('OPP-94822', 'Nebula Data Platform', 'Nebula Systems', 'Proposal', 64500.00, '2026-08-01', 'Marcus Thorne',
 'POC delivered successfully across 3 data sources. Buying committee aligned on the technical fit; pricing review is the remaining blocker.',
 PARSE_JSON('["Deliver final pricing sheet", "Confirm SOC2 documentation"]'),
 'Watch for procurement delay — they have a 6-week vendor onboarding cycle.',
 'Bundle the migration services to justify list pricing.',
 58.00, '2026-05-18', -2.00),

-- OPP-94823: CloudScale Renewal+
('OPP-94823', 'CloudScale Renewal+', 'CloudScale Corp', 'Qualification', 210000.00, '2026-06-22', 'Sarah Jenkins',
 'Renewal at risk. Champion left the org last month; need to re-establish executive sponsor.',
 PARSE_JSON('["Map new buying committee", "Request exec sponsor intro"]'),
 'Escalate to VP if no exec contact secured within 2 weeks.',
 'Treat as new logo motion until we re-anchor the relationship.',
 34.00, '2026-05-20', -12.00),

-- OPP-94824: Ironwood Fleet Telemetry
('OPP-94824', 'Ironwood Fleet Telemetry', 'Ironwood Logistics', 'Closed Won', 12000.00, '2026-04-20', 'David Kim',
 'Pilot signed. Limited scope, but a strong reference customer for the logistics vertical.',
 PARSE_JSON('["Kickoff scheduled for May 1", "Loop in CSM"]'),
 'Strong foothold — line up expansion conversation in Q4.',
 'Document the integration patterns for reuse.',
 74.00, '2026-04-22', 3.00),

-- OPP-94825: Stellar Analytics Tier 2
('OPP-94825', 'Stellar Analytics Tier 2', 'Stellar Tech', 'Proposal', 89000.00, '2026-09-10', 'Sarah Jenkins',
 'Evaluating us against two competitors. Differentiation is governance + audit features.',
 PARSE_JSON('["Run governance demo", "Share Forrester comparison brief"]'),
 'Decision committee meets June 15.',
 'Push for a paid POC to lock out competitors.',
 42.00, '2026-05-15', 0.00),

-- OPP-94826: FinStream Compliance Module
('OPP-94826', 'FinStream Compliance Module', 'FinStream Inc', 'Negotiation', 15500.00, '2026-06-05', 'Marcus Thorne',
 'Down to redlines. Legal review on indemnification clauses.',
 PARSE_JSON('["Legal response by EOW", "Confirm start date"]'),
 'Small ticket but strategic — first finance vertical win.',
 'Hold the line on uptime SLA wording.',
 91.00, '2026-05-22', 4.00),

-- OPP-94827: Vertex Media Migration
('OPP-94827', 'Vertex Media Migration', 'Vertex Media', 'Qualification', 45000.00, '2026-08-18', 'Priya Patel',
 'Discovery complete. Migrating off a homegrown system; scope is well defined.',
 PARSE_JSON('["Send architecture diagram", "Schedule security review"]'),
 'Champion is the new VP Eng — strong relationship signal.',
 'Standard migration package should fit.',
 68.00, '2026-05-19', 6.00),

-- OPP-94828: Capital Bank Security Suite
('OPP-94828', 'Capital Bank Security Suite', 'Capital Bank', 'Proposal', 310000.00, '2026-10-01', 'Elena Rodriguez',
 'Large deal. Multiple stakeholders across InfoSec, IT, and Risk. Procurement-driven.',
 PARSE_JSON('["Submit RFP response", "Schedule InfoSec deep dive"]'),
 'Forecast as commit only after RFP scoring.',
 'Bring solutions architect to InfoSec session.',
 47.00, '2026-05-21', 2.00),

-- OPP-94829: Skyline Cloud Native Upgrade
('OPP-94829', 'Skyline Cloud Native Upgrade', 'Skyline Dev', 'Negotiation', 140000.00, '2026-06-30', 'David Kim',
 'Strong technical fit. Pricing approved internally. Awaiting customer board sign-off.',
 PARSE_JSON('["Confirm board outcome", "Prep onboarding plan"]'),
 'High confidence close this quarter.',
 'Pre-stage CSM for fast handoff.',
 92.00, '2026-05-23', 1.00),

-- OPP-94830: Bloom Marketing Automations
('OPP-94830', 'Bloom Marketing Automations', 'Bloom Agency', 'Closed Won', 55000.00, '2026-03-15', 'Priya Patel',
 'Closed Q1. Expansion conversation already in motion for additional seats.',
 PARSE_JSON('["Schedule QBR", "Identify expansion sponsor"]'),
 'Reference candidate for marketing vertical.',
 'Capture case study within 60 days.',
 98.00, '2026-04-01', 0.00),

-- OPP-94831: Local Threads Pilot
('OPP-94831', 'Local Threads Pilot', 'Local Threads', 'Closed Lost', 12500.00, '2026-02-28', 'Marcus Thorne',
 'Budget pulled mid-cycle. Champion remains warm; revisit Q4.',
 PARSE_JSON('["Quarterly check-in scheduled", "Send relevant case study"]'),
 'Move to nurture. Not a fit until they raise next round.',
 'Tag for nurture; revisit FY27.',
 8.00, '2026-03-01', -20.00),

-- OPP-94832: Maersk Logistics Expansion
('OPP-94832', 'Maersk Logistics Expansion', 'Maersk Group', 'Prospecting', 85000.00, '2026-11-15', 'David Kim',
 'Early-stage. Inbound lead from website demo. Discovery scheduled.',
 PARSE_JSON('["Run discovery call", "Qualify budget and authority"]'),
 'Don''t over-invest until qualification confirms fit.',
 'Standard discovery deck — no SC time yet.',
 32.00, '2026-05-10', 0.00),

-- OPP-94833: FinTech Platform Migration
('OPP-94833', 'FinTech Platform Migration', 'FinTech Solutions', 'Prospecting', 120000.00, '2026-10-20', 'Elena Rodriguez',
 'Outbound-sourced. CTO is engaged; aligning on evaluation criteria.',
 PARSE_JSON('["Send evaluation framework", "Confirm POC scope"]'),
 'Promising. Allocate SC after POC scope confirmed.',
 'Cap POC at 3 weeks.',
 55.00, '2026-05-17', 5.00),

-- OPP-94834: Atlas Insurance Underwriting
('OPP-94834', 'Atlas Insurance Underwriting', 'Atlas Insurance', 'Qualification', 178000.00, '2026-09-25', 'Elena Rodriguez',
 'Complex compliance landscape. Need to validate data residency requirements.',
 PARSE_JSON('["Confirm data residency", "Schedule compliance Q&A"]'),
 'Strategic deal for insurance vertical entry.',
 'Loop in compliance SME for next call.',
 61.00, '2026-05-20', 3.00),

-- OPP-94835: Helix Bio Research Suite
('OPP-94835', 'Helix Bio Research Suite', 'Helix Biotech', 'Proposal', 96000.00, '2026-07-30', 'Priya Patel',
 'Custom research workflow validated. Awaiting procurement engagement.',
 PARSE_JSON('["Procurement intake form", "Confirm fiscal calendar"]'),
 'Fiscal year ends Sept — push to close before then.',
 'Offer Q3 incentive if needed to accelerate.',
 70.00, '2026-05-19', 2.00),

-- OPP-94836: Northwind ERP Connector
('OPP-94836', 'Northwind ERP Connector', 'Northwind Traders', 'Negotiation', 38000.00, '2026-06-10', 'Marcus Thorne',
 'Standard connector deal. Contract review in legal.',
 PARSE_JSON('["Resolve auto-renewal clause"]'),
 'Likely close this month.',
 'Standard terms acceptable.',
 84.00, '2026-05-21', 1.00),

-- OPP-94837: Quantum Labs Platform
('OPP-94837', 'Quantum Labs Platform', 'Quantum Labs', 'Closed Lost', 220000.00, '2026-04-05', 'Sarah Jenkins',
 'Lost to incumbent. Price was not the issue — switching costs were too high.',
 PARSE_JSON('["Schedule 6-month revisit"]'),
 'Good qualification despite the loss. Document learnings.',
 'Brief the team on the incumbent''s stickiness factors.',
 12.00, '2026-04-06', -30.00),

-- OPP-94838: Pioneer Health Records
('OPP-94838', 'Pioneer Health Records', 'Pioneer Health', 'Qualification', 265000.00, '2026-12-01', 'Elena Rodriguez',
 'HIPAA workflow review in progress. Long sales cycle expected.',
 PARSE_JSON('["Sign BAA", "Map compliance gap list"]'),
 'Forecast for next quarter, not this one.',
 'Pull in compliance team weekly.',
 52.00, '2026-05-18', 4.00),

-- OPP-94839: Beacon Education Rollout
('OPP-94839', 'Beacon Education Rollout', 'Beacon Education', 'Prospecting', 41000.00, '2026-08-25', 'Priya Patel',
 'Education vertical pilot. Budget unconfirmed.',
 PARSE_JSON('["Confirm fiscal availability", "Run product overview"]'),
 'Education deals tend to slip — set conservative date.',
 'Reuse education vertical demo.',
 38.00, '2026-05-14', 1.00),

-- OPP-94840: Granite Manufacturing IoT
('OPP-94840', 'Granite Manufacturing IoT', 'Granite Manufacturing', 'Proposal', 132000.00, '2026-09-05', 'David Kim',
 'On-prem deployment. Proposal includes managed services line.',
 PARSE_JSON('["Confirm on-prem hardware list", "Schedule install planning call"]'),
 'Margin is thin — verify services pricing.',
 'Loop in deployment lead before final pricing.',
 66.00, '2026-05-22', 2.00);

-- Verify the data was loaded
SELECT COUNT(*) as total_opportunities FROM opportunities;

-- Show a summary by stage
SELECT stage, COUNT(*) as count, SUM(amount) as total_amount
FROM opportunities
GROUP BY stage
ORDER BY count DESC;

-- Show opportunities by owner
SELECT owner, COUNT(*) as count
FROM opportunities
GROUP BY owner
ORDER BY count DESC;
