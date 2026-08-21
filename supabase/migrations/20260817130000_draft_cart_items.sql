-- Draft cart items: persist pending order_items without kitchen tickets.
-- send_to_kitchen promotes pending rows instead of inserting duplicates.
-- Do not run automatically against production; apply after review.

CREATE OR REPLACE FUNCTION upsert_draft_order_item(
  p_order_id UUID,
  p_menu_item_id UUID,
  p_quantity INT,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_menu menu_items%ROWTYPE;
  v_item_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF COALESCE(get_user_role()::text, '') NOT IN ('admin', 'waiter') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF NOT (
    is_admin()
    OR v_order.waiter_id = auth.uid()
    OR v_order.created_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF v_order.status NOT IN ('open', 'draft') THEN
    RAISE EXCEPTION 'Order cannot accept draft items';
  END IF;

  IF p_quantity < 1 THEN
    DELETE FROM order_items
    WHERE order_id = p_order_id
      AND menu_item_id = p_menu_item_id
      AND status = 'pending';
    PERFORM recalculate_order_totals(p_order_id);
    RETURN NULL;
  END IF;

  SELECT * INTO v_menu FROM menu_items WHERE id = p_menu_item_id AND is_available = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Menu item not available';
  END IF;

  SELECT id INTO v_item_id
  FROM order_items
  WHERE order_id = p_order_id
    AND menu_item_id = p_menu_item_id
    AND status = 'pending'
  LIMIT 1;

  IF v_item_id IS NOT NULL THEN
    UPDATE order_items SET
      quantity = p_quantity,
      unit_price = v_menu.price,
      total_price = v_menu.price * p_quantity,
      notes = p_notes,
      updated_at = now()
    WHERE id = v_item_id;
  ELSE
    INSERT INTO order_items (
      order_id, menu_item_id, kitchen_ticket_id,
      quantity, unit_price, total_price, notes,
      status, idempotency_key
    ) VALUES (
      p_order_id,
      v_menu.id,
      NULL,
      p_quantity,
      v_menu.price,
      v_menu.price * p_quantity,
      p_notes,
      'pending',
      'draft:' || p_order_id::text || ':' || v_menu.id::text
    )
    RETURNING id INTO v_item_id;
  END IF;

  PERFORM recalculate_order_totals(p_order_id);
  RETURN v_item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION upsert_draft_order_item(UUID, UUID, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_draft_order_item(UUID, UUID, INT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION send_to_kitchen(
  p_order_id UUID,
  p_items JSONB,
  p_idempotency_key TEXT
)
RETURNS UUID AS $$
DECLARE
  v_ticket_id UUID;
  v_item JSONB;
  v_menu_item menu_items%ROWTYPE;
  v_order orders%ROWTYPE;
  v_qty INT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM order_items
    WHERE idempotency_key = p_idempotency_key
       OR idempotency_key LIKE p_idempotency_key || '-%'
  ) THEN
    SELECT kitchen_ticket_id INTO v_ticket_id
    FROM order_items
    WHERE idempotency_key = p_idempotency_key
       OR idempotency_key LIKE p_idempotency_key || '-%'
    LIMIT 1;
    RETURN v_ticket_id;
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.status NOT IN ('open', 'draft') THEN
    RAISE EXCEPTION 'Order cannot accept new kitchen sends';
  END IF;

  INSERT INTO kitchen_tickets (order_id, table_id, waiter_id, order_type, status)
  VALUES (
    p_order_id,
    v_order.table_id,
    COALESCE(v_order.waiter_id, v_order.created_by),
    v_order.order_type,
    'new'
  )
  RETURNING id INTO v_ticket_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_menu_item FROM menu_items WHERE id = (v_item->>'menu_item_id')::UUID;
    v_qty := (v_item->>'quantity')::INT;

    UPDATE order_items SET
      kitchen_ticket_id = v_ticket_id,
      quantity = v_qty,
      notes = v_item->>'notes',
      unit_price = v_menu_item.price,
      total_price = v_menu_item.price * v_qty,
      status = 'sent',
      idempotency_key = p_idempotency_key || '-' || v_menu_item.id::text,
      sent_to_kitchen_at = now(),
      updated_at = now()
    WHERE order_id = p_order_id
      AND menu_item_id = v_menu_item.id
      AND status = 'pending';

    IF NOT FOUND THEN
      INSERT INTO order_items (
        order_id, menu_item_id, kitchen_ticket_id,
        quantity, unit_price, total_price, notes,
        status, idempotency_key, sent_to_kitchen_at
      ) VALUES (
        p_order_id,
        v_menu_item.id,
        v_ticket_id,
        v_qty,
        v_menu_item.price,
        v_menu_item.price * v_qty,
        v_item->>'notes',
        'sent',
        p_idempotency_key || '-' || v_menu_item.id::text,
        now()
      );
    END IF;
  END LOOP;

  PERFORM recalculate_order_totals(p_order_id);

  IF v_order.table_id IS NOT NULL THEN
    UPDATE restaurant_tables SET status = 'has_order' WHERE id = v_order.table_id;
  END IF;

  IF v_order.order_type IN ('pickup', 'delivery') THEN
    UPDATE orders SET fulfillment_status = 'in_kitchen', status = 'open' WHERE id = p_order_id;
    PERFORM log_order_event(p_order_id, 'sent_to_kitchen', 'Oshxonaga yuborildi', auth.uid(), '{}');
  ELSE
    UPDATE orders SET status = 'open' WHERE id = p_order_id;
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_data)
  VALUES (auth.uid(), 'order_sent_to_kitchen', 'kitchen_ticket', v_ticket_id,
    jsonb_build_object('order_id', p_order_id, 'idempotency_key', p_idempotency_key));

  RETURN v_ticket_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
