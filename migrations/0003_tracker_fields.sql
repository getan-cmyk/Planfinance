ALTER TABLE categories ADD COLUMN color TEXT;
ALTER TABLE transactions ADD COLUMN payment_method TEXT;
ALTER TABLE transactions ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
CREATE INDEX transactions_type_date_idx ON transactions(user_id, type, transaction_date DESC);
