DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='binance_order_id') THEN
    ALTER TABLE orders RENAME COLUMN binance_order_id TO broker_order_id;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS orders_broker_order_id_unique ON orders(broker_order_id) WHERE broker_order_id IS NOT NULL;
