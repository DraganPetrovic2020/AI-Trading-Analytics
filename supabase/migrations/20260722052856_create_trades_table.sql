/*
# Create trades table for SOL/USDT trading history (single-tenant, no auth)

1. Purpose
- Persistes all manual and AI auto-trade execution records for the
  SOL/USDT Binance AI trading dashboard.
- Both simulated (SIM) and live (LIVE) trades are stored here so the
  frontend trade-history panel can display and preserve them across reloads.

2. New Tables
- `trades`
  - `id` (uuid, primary key)
  - `mode` (text): "SIM" or "LIVE"
  - `order_type` (text): e.g. "MARKET", "LIMIT", "AI_AUTO"
  - `side` (text): "BUY" or "SELL"
  - `symbol` (text, default "SOLUSDT")
  - `price` (numeric, not null): execution price in USDT
  - `qty` (numeric, not null): SOL quantity
  - `amount_usdt` (numeric, not null): USDT notional value
  - `note` (text): AI signal reason or order id
  - `created_at` (timestamptz, default now())

3. Security
- Enable RLS on `trades`.
- Single-tenant no-auth app: allow anon + authenticated full CRUD because
  the data is intentionally public/shared (one trading workspace).
*/

CREATE TABLE IF NOT EXISTS trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL,
  order_type text NOT NULL,
  side text NOT NULL,
  symbol text NOT NULL DEFAULT 'SOLUSDT',
  price numeric NOT NULL,
  qty numeric NOT NULL,
  amount_usdt numeric NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_trades" ON trades;
CREATE POLICY "anon_select_trades" ON trades FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_trades" ON trades;
CREATE POLICY "anon_insert_trades" ON trades FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_trades" ON trades;
CREATE POLICY "anon_update_trades" ON trades FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_trades" ON trades;
CREATE POLICY "anon_delete_trades" ON trades FOR DELETE
  TO anon, authenticated USING (true);
