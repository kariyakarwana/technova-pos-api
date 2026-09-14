-- Warranties belong to serialized sale items. A customer remains optional for
-- walk-in POS sales, while registered customers are linked when selected.
ALTER TABLE "warranties" ALTER COLUMN "customerId" DROP NOT NULL;
