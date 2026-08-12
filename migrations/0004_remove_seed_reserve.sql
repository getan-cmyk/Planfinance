-- New users no longer receive a synthetic 30,000 THB opening balance.
-- For existing users, only reset the old seed account when it has never been used.
UPDATE accounts
SET balance_satang = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE name = 'เงินออมเริ่มต้น'
  AND balance_satang = 3000000
  AND NOT EXISTS (
    SELECT 1 FROM transactions WHERE transactions.account_id = accounts.id
  );
