-- ============================================================================
-- SECURED-AJO ADDITIONAL TRIGGERS
-- ============================================================================
-- This file contains additional triggers for business logic automation.
-- These triggers complement the base triggers in schema.sql
--
-- IMPORTANT: Run this file AFTER schema.sql and functions.sql
-- ============================================================================

-- ============================================================================
-- TRIGGER: Auto-create notifications on contribution payment
-- ============================================================================
-- Creates notification when a contribution is paid
-- Notifies group creator and updates group progress
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_contribution_paid()
RETURNS TRIGGER AS $$
DECLARE
  v_group_name VARCHAR(255);
  v_user_name VARCHAR(255);
  v_group_creator UUID;
BEGIN
  -- Only trigger when status changes to 'paid'
  IF OLD.status != 'paid' AND NEW.status = 'paid' THEN
    -- Get group and user details
    SELECT g.name, g.created_by, u.full_name
    INTO v_group_name, v_group_creator, v_user_name
    FROM groups g
    JOIN users u ON NEW.user_id = u.id
    WHERE g.id = NEW.group_id;
    
    -- Notify the contributor
    INSERT INTO notifications (
      user_id,
      type,
      title,
      message,
      related_group_id
    ) VALUES (
      NEW.user_id,
      'contribution_paid',
      'Payment Received',
      'Your contribution of ₦' || NEW.amount || ' for ' || v_group_name || ' has been received.',
      NEW.group_id
    );
    
    -- Notify group creator (if not the contributor)
    IF v_group_creator != NEW.user_id THEN
      INSERT INTO notifications (
        user_id,
        type,
        title,
        message,
        related_group_id
      ) VALUES (
        v_group_creator,
        'contribution_paid',
        'Member Payment Received',
        v_user_name || ' has paid their contribution of ₦' || NEW.amount || ' for ' || v_group_name || '.',
        NEW.group_id
      );
    END IF;
    
    -- Create audit log
    INSERT INTO audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      details
    ) VALUES (
      NEW.user_id,
      'contribution_paid',
      'contribution',
      NEW.id::uuid,
      jsonb_build_object(
        'group_id', NEW.group_id,
        'cycle_number', NEW.cycle_number,
        'amount', NEW.amount,
        'service_fee', NEW.service_fee
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_notify_contribution_paid
AFTER UPDATE ON contributions
FOR EACH ROW
EXECUTE FUNCTION notify_contribution_paid();

COMMENT ON TRIGGER trigger_notify_contribution_paid ON contributions IS 
  'Creates notifications and audit logs when contribution is paid';

-- ============================================================================
-- TRIGGER: Auto-check cycle completion
-- ============================================================================
-- Automatically checks if a cycle is complete when contribution is paid
-- Triggers cycle completion processing if all members have paid
-- ============================================================================

CREATE OR REPLACE FUNCTION check_cycle_completion()
RETURNS TRIGGER AS $$
DECLARE
  v_is_complete BOOLEAN;
BEGIN
  -- Only check when status changes to 'paid'
  IF OLD.status != 'paid' AND NEW.status = 'paid' THEN
    -- Check if cycle is now complete
    v_is_complete := is_cycle_complete(NEW.group_id, NEW.cycle_number);
    
    IF v_is_complete THEN
      -- Process cycle completion asynchronously
      -- Note: In a real implementation, this would be queued for async processing
      -- For now, we'll call the function directly
      PERFORM process_cycle_completion(NEW.group_id);
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_check_cycle_completion
AFTER UPDATE ON contributions
FOR EACH ROW
EXECUTE FUNCTION check_cycle_completion();

COMMENT ON TRIGGER trigger_check_cycle_completion ON contributions IS 
  'Automatically processes cycle completion when all contributions are paid';

-- ============================================================================
-- TRIGGER: Auto-create notification on payout processing
-- ============================================================================
-- Creates notifications when payout status changes
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_payout_status_change()
RETURNS TRIGGER AS $$
DECLARE
  v_group_name VARCHAR(255);
BEGIN
  -- Get group name
  SELECT name INTO v_group_name
  FROM groups
  WHERE id = NEW.related_group_id;
  
  -- Notify on status change to 'completed'
  IF OLD.status != 'completed' AND NEW.status = 'completed' THEN
    INSERT INTO notifications (
      user_id,
      type,
      title,
      message,
      related_group_id
    ) VALUES (
      NEW.recipient_id,
      'payout_received',
      'Payout Completed!',
      'Your payout of ₦' || NEW.amount || ' for ' || v_group_name || ' has been processed successfully.',
      NEW.related_group_id
    );
    
    -- Create audit log
    INSERT INTO audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      details
    ) VALUES (
      NEW.recipient_id,
      'payout_completed',
      'payout',
      NEW.id::uuid,
      jsonb_build_object(
        'group_id', NEW.related_group_id,
        'cycle_number', NEW.cycle_number,
        'amount', NEW.amount
      )
    );
  END IF;
  
  -- Notify on status change to 'failed'
  IF OLD.status != 'failed' AND NEW.status = 'failed' THEN
    INSERT INTO notifications (
      user_id,
      type,
      title,
      message,
      related_group_id
    ) VALUES (
      NEW.recipient_id,
      'general',
      'Payout Failed',
      'There was an issue processing your payout for ' || v_group_name || '. Please contact support.',
      NEW.related_group_id
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_notify_payout_status
AFTER UPDATE ON payouts
FOR EACH ROW
EXECUTE FUNCTION notify_payout_status_change();

COMMENT ON TRIGGER trigger_notify_payout_status ON payouts IS 
  'Creates notifications when payout status changes';

-- ============================================================================
-- TRIGGER: Auto-notify on penalty application
-- ============================================================================
-- Creates notification when a penalty is applied to a user
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_penalty_applied()
RETURNS TRIGGER AS $$
DECLARE
  v_group_name VARCHAR(255);
BEGIN
  -- Get group name
  SELECT name INTO v_group_name
  FROM groups
  WHERE id = NEW.group_id;
  
  -- Create notification on penalty insert
  INSERT INTO notifications (
    user_id,
    type,
    title,
    message,
    related_group_id
  ) VALUES (
    NEW.user_id,
    'penalty_applied',
    'Penalty Applied',
    'A penalty of ₦' || NEW.amount || ' has been applied for ' || v_group_name || '. Reason: ' || NEW.reason,
    NEW.group_id
  );
  
  -- Create audit log
  INSERT INTO audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    details
  ) VALUES (
    NEW.user_id,
    'penalty_applied',
    'penalty',
    NEW.id::uuid,
    jsonb_build_object(
      'group_id', NEW.group_id,
      'amount', NEW.amount,
      'penalty_type', NEW.type,
      'reason', NEW.reason
    )
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_notify_penalty_applied
AFTER INSERT ON penalties
FOR EACH ROW
EXECUTE FUNCTION notify_penalty_applied();

COMMENT ON TRIGGER trigger_notify_penalty_applied ON penalties IS 
  'Creates notification when penalty is applied';

-- ============================================================================
-- TRIGGER: Auto-notify on group member join
-- ============================================================================
-- Notifies group creator when a new member joins
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_member_joined()
RETURNS TRIGGER AS $$
DECLARE
  v_group_name VARCHAR(255);
  v_user_name VARCHAR(255);
  v_group_creator UUID;
BEGIN
  -- Get group and user details
  SELECT g.name, g.created_by, u.full_name
  INTO v_group_name, v_group_creator, v_user_name
  FROM groups g
  JOIN users u ON NEW.user_id = u.id
  WHERE g.id = NEW.group_id;
  
  -- Notify the new member
  INSERT INTO notifications (
    user_id,
    type,
    title,
    message,
    related_group_id
  ) VALUES (
    NEW.user_id,
    'member_joined',
    'Welcome to ' || v_group_name,
    'You have successfully joined ' || v_group_name || '. Your position is ' || NEW.position || '.',
    NEW.group_id
  );
  
  -- Notify group creator (if not the new member)
  IF v_group_creator != NEW.user_id THEN
    INSERT INTO notifications (
      user_id,
      type,
      title,
      message,
      related_group_id
    ) VALUES (
      v_group_creator,
      'member_joined',
      'New Member Joined',
      v_user_name || ' has joined ' || v_group_name || ' at position ' || NEW.position || '.',
      NEW.group_id
    );
  END IF;
  
  -- Create audit log
  INSERT INTO audit_logs (
    user_id,
    action,
    resource_type,
    resource_id,
    details
  ) VALUES (
    NEW.user_id,
    'group_joined',
    'group_member',
    NEW.id::uuid,
    jsonb_build_object(
      'group_id', NEW.group_id,
      'position', NEW.position
    )
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_notify_member_joined
AFTER INSERT ON group_members
FOR EACH ROW
EXECUTE FUNCTION notify_member_joined();

COMMENT ON TRIGGER trigger_notify_member_joined ON group_members IS 
  'Creates notifications when a member joins a group';

-- ============================================================================
-- TRIGGER: Auto-notify on group status change
-- ============================================================================
-- Notifies all group members when group status changes
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_group_status_change()
RETURNS TRIGGER AS $$
DECLARE
  v_message TEXT;
BEGIN
  -- Only trigger if status actually changed
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    -- Determine message based on new status
    v_message := CASE NEW.status
      WHEN 'active' THEN 'Group is now active! Start making your contributions.'
      WHEN 'completed' THEN 'Congratulations! The group has completed all cycles successfully.'
      WHEN 'cancelled' THEN 'This group has been cancelled.'
      ELSE 'Group status has been updated to: ' || NEW.status
    END;
    
    -- Notify all members
    INSERT INTO notifications (
      user_id,
      type,
      title,
      message,
      related_group_id
    )
    SELECT 
      gm.user_id,
      'group_status_change',
      'Group Status Update: ' || NEW.name,
      v_message,
      NEW.id
    FROM group_members gm
    WHERE gm.group_id = NEW.id
      AND gm.status = 'active';
    
    -- Create audit log
    INSERT INTO audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      details
    ) VALUES (
      NEW.created_by,
      'group_status_changed',
      'group',
      NEW.id::uuid,
      jsonb_build_object(
        'old_status', OLD.status,
        'new_status', NEW.status
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_notify_group_status_change
AFTER UPDATE ON groups
FOR EACH ROW
EXECUTE FUNCTION notify_group_status_change();

COMMENT ON TRIGGER trigger_notify_group_status_change ON groups IS 
  'Notifies all group members when group status changes';

-- ============================================================================
-- TRIGGER: Prevent duplicate group membership
-- ============================================================================
-- Ensures a user cannot join the same group twice
-- ============================================================================

CREATE OR REPLACE FUNCTION prevent_duplicate_membership()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if user is already a member
  IF EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = NEW.group_id
      AND user_id = NEW.user_id
      AND id != NEW.id
  ) THEN
    RAISE EXCEPTION 'User is already a member of this group';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_prevent_duplicate_membership
BEFORE INSERT ON group_members
FOR EACH ROW
EXECUTE FUNCTION prevent_duplicate_membership();

COMMENT ON TRIGGER trigger_prevent_duplicate_membership ON group_members IS 
  'Prevents a user from joining the same group twice';

-- ============================================================================
-- TRIGGER: Validate group capacity before member join
-- ============================================================================
-- Ensures group doesn't exceed member limit
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_group_capacity()
RETURNS TRIGGER AS $$
DECLARE
  v_total_members INTEGER;
  v_current_members INTEGER;
BEGIN
  -- Get group member counts (using actual count from group_members table)
  SELECT g.total_members, COALESCE(COUNT(gm.id), 0)
  INTO v_total_members, v_current_members
  FROM groups g
  LEFT JOIN group_members gm ON gm.group_id = g.id
  WHERE g.id = NEW.group_id
  GROUP BY g.id, g.total_members;
  
  -- If no result, fetch just total_members
  IF v_total_members IS NULL THEN
    SELECT total_members INTO v_total_members FROM groups WHERE id = NEW.group_id;
    v_current_members := 0;
  END IF;
  
  -- Check if group is full
  IF v_current_members >= v_total_members THEN
    RAISE EXCEPTION 'Group is full (% / % members)', v_current_members, v_total_members;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_validate_group_capacity
BEFORE INSERT ON group_members
FOR EACH ROW
EXECUTE FUNCTION validate_group_capacity();

COMMENT ON TRIGGER trigger_validate_group_capacity ON group_members IS 
  'Validates group has space before allowing new member';

-- ============================================================================
-- TRIGGER: Auto-create transaction record on contribution payment
-- ============================================================================
-- Creates a transaction record when a contribution is paid
-- Note: Payment method defaults to 'paystack' as it's the only supported
-- payment gateway currently. Future enhancement: Add payment_method column
-- to contributions table to support multiple payment providers.
-- ============================================================================

CREATE OR REPLACE FUNCTION create_contribution_transaction()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create transaction when status changes to 'paid'
  IF OLD.status != 'paid' AND NEW.status = 'paid' THEN
    INSERT INTO transactions (
      user_id,
      group_id,
      type,
      amount,
      status,
      reference,
      payment_method,
      metadata
    ) VALUES (
      NEW.user_id,
      NEW.group_id,
      'contribution',
      NEW.amount,
      'completed',
      COALESCE(NEW.transaction_ref, generate_payment_reference('CONTRIB')),
      'paystack', -- Default payment provider
      jsonb_build_object(
        'contribution_id', NEW.id,
        'cycle_number', NEW.cycle_number,
        'service_fee', NEW.service_fee
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_contribution_transaction
AFTER UPDATE ON contributions
FOR EACH ROW
EXECUTE FUNCTION create_contribution_transaction();

COMMENT ON TRIGGER trigger_create_contribution_transaction ON contributions IS 
  'Creates transaction record when contribution is paid';

-- ============================================================================
-- TRIGGER: Auto-create transaction record on payout
-- ============================================================================
-- Creates a transaction record when a payout is completed
-- ============================================================================

CREATE OR REPLACE FUNCTION create_payout_transaction()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create transaction when status changes to 'completed'
  IF OLD.status != 'completed' AND NEW.status = 'completed' THEN
    INSERT INTO transactions (
      user_id,
      group_id,
      type,
      amount,
      status,
      reference,
      payment_method,
      metadata
    ) VALUES (
      NEW.recipient_id,
      NEW.related_group_id,
      'payout',
      NEW.amount,
      'completed',
      COALESCE(NEW.payment_reference, generate_payment_reference('PAYOUT')),
      'bank_transfer',
      jsonb_build_object(
        'payout_id', NEW.id,
        'cycle_number', NEW.cycle_number
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_payout_transaction
AFTER UPDATE ON payouts
FOR EACH ROW
EXECUTE FUNCTION create_payout_transaction();

COMMENT ON TRIGGER trigger_create_payout_transaction ON payouts IS 
  'Creates transaction record when payout is completed';

-- ============================================================================
-- TRIGGER: Validate security deposit before group activation
-- ============================================================================
-- Ensures all members have paid security deposit before group can start
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_security_deposits()
RETURNS TRIGGER AS $$
DECLARE
  v_unpaid_count INTEGER;
BEGIN
  -- Only check when changing from 'forming' to 'active'
  IF OLD.status = 'forming' AND NEW.status = 'active' THEN
    -- Count members who haven't paid security deposit
    SELECT COUNT(*)
    INTO v_unpaid_count
    FROM group_members
    WHERE group_id = NEW.id
      AND has_paid_security_deposit = false
      AND status = 'active';
    
    -- Raise error if any member hasn't paid
    IF v_unpaid_count > 0 THEN
      RAISE EXCEPTION 'Cannot activate group: % members have not paid security deposit', v_unpaid_count;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_validate_security_deposits
BEFORE UPDATE ON groups
FOR EACH ROW
EXECUTE FUNCTION validate_security_deposits();

COMMENT ON TRIGGER trigger_validate_security_deposits ON groups IS 
  'Validates all security deposits are paid before group activation';

-- ============================================================================
-- END OF ADDITIONAL TRIGGERS
-- ============================================================================
--
-- USAGE:
-- 1. Run this file after schema.sql and functions.sql
-- 2. Triggers will automatically execute on specified events
-- 3. Monitor trigger execution via audit_logs and notifications tables
-- 4. Disable triggers if needed: ALTER TABLE table_name DISABLE TRIGGER trigger_name;
--
-- NOTES:
-- - Triggers execute in the same transaction as the triggering statement
-- - Failed triggers will rollback the entire transaction
-- - Test triggers thoroughly before deploying to production
-- - Monitor performance impact of triggers
-- - Consider async processing for expensive operations
--
-- ============================================================================
-- TRIGGER: Update group current_members count
-- ============================================================================
-- Automatically updates the current_members count when members join or leave
-- ============================================================================

CREATE OR REPLACE FUNCTION update_group_member_count()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    -- Increment current_members when a new member joins
    UPDATE groups
    SET current_members = current_members + 1,
        updated_at = NOW()
    WHERE id = NEW.group_id;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    -- Decrement current_members when a member leaves
    UPDATE groups
    SET current_members = GREATEST(0, current_members - 1),
        updated_at = NOW()
    WHERE id = OLD.group_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_group_member_count
AFTER INSERT OR DELETE ON group_members
FOR EACH ROW
EXECUTE FUNCTION update_group_member_count();

COMMENT ON TRIGGER trigger_update_group_member_count ON group_members IS 
  'Automatically updates the current_members count in groups table when members join or leave';

-- ============================================================================
-- TRIGGER: Auto-add creator as member on group creation
-- ============================================================================
-- Automatically adds the group creator as the first member when a group is created
-- This ensures consistency and eliminates the need for manual member addition
-- ============================================================================

CREATE TRIGGER trigger_auto_add_creator
AFTER INSERT ON groups
FOR EACH ROW
EXECUTE FUNCTION auto_add_creator_as_member();

COMMENT ON TRIGGER trigger_auto_add_creator ON groups IS 
  'Automatically adds the group creator as first member with position 1 when group is created';

-- ============================================================================
