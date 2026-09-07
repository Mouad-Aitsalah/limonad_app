-- Opt-in per-customer credit ceiling. Additive, non-destructive.
-- false (default) = no ceiling enforced (credit sales always allowed),
-- which is also the value every existing Customer row gets.
-- true = Customer.creditLimit (> 0) is checked against the real computed
-- debt on each new credit sale (counter-sales / pending-sales / driver-sales).
ALTER TABLE "Customer" ADD COLUMN "creditLimitEnabled" BOOLEAN NOT NULL DEFAULT false;
