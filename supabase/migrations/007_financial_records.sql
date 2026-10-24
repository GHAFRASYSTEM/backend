-- 1. Create the category enum type
CREATE TYPE transaction_category AS ENUM ('income', 'expense');

-- 2. Create the financial records table
CREATE TABLE financial_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
    created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    category transaction_category NOT NULL,
    purpose VARCHAR(255) NOT NULL,
    counterparty VARCHAR(255) NOT NULL,
    document_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create an index for fast filtering
CREATE INDEX idx_financial_records_category_date ON financial_records (category, created_date);