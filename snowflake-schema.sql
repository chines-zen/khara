-- Snowflake table schema for SE Opportunity Rigor application
-- This schema matches the structure expected by the application

-- Create the opportunities table
CREATE OR REPLACE TABLE opportunities (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(500) NOT NULL,
    account VARCHAR(500) NOT NULL,
    stage VARCHAR(50) NOT NULL,
    amount NUMBER(15, 2) NOT NULL,
    close_date DATE NOT NULL,
    owner VARCHAR(200) NOT NULL,
    sc_notes TEXT,
    next_steps VARIANT, -- JSON array of strings
    manager_notes TEXT,
    sc_manager_notes TEXT,
    d_score NUMBER(5, 2) NOT NULL,
    recent_d_score_date DATE NOT NULL,
    d_score_delta NUMBER(5, 2) NOT NULL,
    created_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    updated_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- Add indexes for better query performance
CREATE INDEX idx_opportunities_stage ON opportunities(stage);
CREATE INDEX idx_opportunities_owner ON opportunities(owner);
CREATE INDEX idx_opportunities_close_date ON opportunities(close_date);
CREATE INDEX idx_opportunities_d_score ON opportunities(d_score);

-- Example: Insert sample data (matching the mock data structure)
-- You can modify this to insert your actual Salesforce data

INSERT INTO opportunities (
    id, name, account, stage, amount, close_date, owner,
    sc_notes, next_steps, manager_notes, sc_manager_notes,
    d_score, recent_d_score_date, d_score_delta
) VALUES (
    'OPP-94821',
    'Acme Global Expansion',
    'Acme Corp',
    'Negotiation',
    142000.00,
    '2026-07-12',
    'Sarah Jenkins',
    'Technical validation complete. Customer requested a custom integration with their legacy ERP.',
    PARSE_JSON('["Send updated MSA to Legal", "Schedule sync with Product (ERP API)"]'),
    'Sarah has strong champion support in the CTO office.',
    'Ensure the implementation costs are fully loaded in the proposal.',
    82.00,
    '2026-05-12',
    5.00
);

-- Add more sample data as needed
-- INSERT INTO opportunities ...

-- Create a view for easy querying with formatted data
CREATE OR REPLACE VIEW v_opportunities_formatted AS
SELECT
    id,
    name,
    account,
    stage,
    amount,
    TO_CHAR(close_date, 'YYYY-MM-DD') as close_date,
    owner,
    sc_notes,
    next_steps,
    manager_notes,
    sc_manager_notes,
    d_score,
    TO_CHAR(recent_d_score_date, 'YYYY-MM-DD') as recent_d_score_date,
    d_score_delta,
    DATEDIFF('day', recent_d_score_date, CURRENT_DATE()) as days_since_update
FROM opportunities;

-- Query to verify the data
-- SELECT * FROM v_opportunities_formatted ORDER BY close_date;
