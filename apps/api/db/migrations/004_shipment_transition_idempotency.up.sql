CREATE TABLE shipment_transition_idempotency (
  shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  idempotency_key varchar(200) NOT NULL,
  request_hash char(64) NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shipment_id, idempotency_key)
);

CREATE INDEX shipments_priority_created_idx ON shipments(priority, created_at DESC);
CREATE INDEX shipments_scheduled_at_idx ON shipments(scheduled_at) WHERE scheduled_at IS NOT NULL;
