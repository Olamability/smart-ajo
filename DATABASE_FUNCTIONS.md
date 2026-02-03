# Database Functions Required for Payment System

This document outlines the database functions that need to be created in Supabase to support the payment system.

## increment_group_members

This function atomically increments the group member count and activates the group when full.

```sql
CREATE OR REPLACE FUNCTION increment_group_members(group_id_param UUID)
RETURNS TABLE (
  id UUID,
  current_members INTEGER,
  total_members INTEGER,
  status TEXT
) AS $$
DECLARE
  v_current_members INTEGER;
  v_total_members INTEGER;
  v_new_status TEXT;
BEGIN
  -- Lock the row to prevent concurrent updates
  SELECT current_members, total_members
  INTO v_current_members, v_total_members
  FROM groups
  WHERE id = group_id_param
  FOR UPDATE;
  
  -- Increment member count
  v_current_members := COALESCE(v_current_members, 0) + 1;
  
  -- Determine new status
  v_new_status := CASE 
    WHEN v_current_members >= v_total_members THEN 'active'
    ELSE 'forming'
  END;
  
  -- Update the group
  UPDATE groups
  SET 
    current_members = v_current_members,
    status = v_new_status,
    updated_at = NOW()
  WHERE id = group_id_param;
  
  -- Return updated group data
  RETURN QUERY
  SELECT g.id, g.current_members, g.total_members, g.status
  FROM groups g
  WHERE g.id = group_id_param;
END;
$$ LANGUAGE plpgsql;
```

## Usage

This function is called from the `verify-payment` Edge Function when a member's payment is verified:

```typescript
const { data: updatedGroup, error: groupUpdateError } = await supabase
  .rpc('increment_group_members', { group_id_param: groupId });
```

## Benefits

1. **Atomic Operation**: Prevents race conditions when multiple users join simultaneously
2. **Automatic Status Update**: Group status is automatically set to 'active' when full
3. **Row Locking**: FOR UPDATE clause ensures only one transaction can update at a time
4. **Consistent State**: Group data is always in a consistent state

## Alternative (Without Database Function)

If you cannot create database functions, you can use this SQL approach:

```typescript
// Alternative: Use conditional update with WHERE clause
const { error: groupUpdateError } = await supabase
  .from('groups')
  .update({ 
    current_members: supabase.raw('current_members + 1'),
    status: supabase.raw(`CASE WHEN current_members + 1 >= total_members THEN 'active' ELSE status END`)
  })
  .eq('id', groupId);
```

However, the database function approach is preferred for better concurrency control.
