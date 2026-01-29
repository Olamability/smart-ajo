/**
 * Shared Payment Processing Logic
 * 
 * This module contains business logic for processing payments.
 * It's shared between verify-payment (primary) and paystack-webhook (backup).
 * 
 * Both Edge Functions execute the same logic to ensure reliability:
 * - verify-payment: Synchronous, user-initiated after payment
 * - paystack-webhook: Asynchronous, Paystack-initiated (backup)
 * 
 * All functions are idempotent - safe to call multiple times.
 * 
 * RACE CONDITION HANDLING:
 * ========================
 * Both verify-payment and webhook may process the same payment concurrently.
 * This is handled through idempotency checks:
 * 
 * 1. Check if has_paid_security_deposit is already true
 * 2. If yes, return success with existing position (no-op)
 * 3. If no, proceed with member creation/update
 * 
 * Database constraints also prevent duplicate member records:
 * - UNIQUE(group_id, user_id) on group_members table
 * - UNIQUE(group_id, user_id, cycle_number) on contributions table
 * 
 * This ensures:
 * - No duplicate memberships created
 * - No duplicate contributions recorded
 * - Same position assigned regardless of which function processes first
 * - Safe concurrent execution without locks
 */

// Type for Supabase client (using any for Deno edge runtime compatibility)
type SupabaseClient = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// Constants
const FIRST_CYCLE_NUMBER = 1;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create transaction records for group payment
 * Separate transactions for security deposit and first contribution
 */
export async function createPaymentTransactions(
  supabase: SupabaseClient,
  groupId: string,
  userId: string,
  reference: string,
  securityDepositAmount: number,
  contributionAmount: number,
  isCreator: boolean
): Promise<boolean> {
  const { error } = await supabase
    .from('transactions')
    .insert([
      {
        user_id: userId,
        group_id: groupId,
        type: 'security_deposit',
        amount: securityDepositAmount,
        status: 'completed',
        reference: `${reference}_SD`,
        description: isCreator 
          ? 'Security deposit for group creation' 
          : 'Security deposit for joining group',
        completed_at: new Date().toISOString(),
      },
      {
        user_id: userId,
        group_id: groupId,
        type: 'contribution',
        amount: contributionAmount,
        status: 'completed',
        reference: `${reference}_C1`,
        description: 'First contribution payment',
        completed_at: new Date().toISOString(),
      },
    ]);

  if (error) {
    console.error('[Payment Processor] Failed to create transactions:', error);
    return false;
  }
  
  console.log('[Payment Processor] Transaction records created');
  return true;
}

// ============================================================================
// BUSINESS LOGIC PROCESSORS
// ============================================================================

/**
 * Acquire advisory lock for payment processing
 * Prevents race conditions between verify-payment and webhook
 */
async function acquirePaymentLock(
  supabase: SupabaseClient,
  reference: string
): Promise<boolean> {
  try {
    // Use PostgreSQL advisory lock based on payment reference hash
    // This prevents concurrent processing of the same payment
    const { data, error } = await supabase.rpc('acquire_payment_lock', {
      payment_ref: reference,
    });

    if (error) {
      console.error('[Payment Lock] Failed to acquire lock:', error);
      return false;
    }

    console.log('[Payment Lock] Lock acquired:', !!data);
    return !!data;
  } catch (error) {
    console.error('[Payment Lock] Exception:', error);
    return false;
  }
}

/**
 * Process group creation payment
 * Adds creator as member with selected slot and marks payment complete
 * 
 * Idempotent: Safe to call multiple times
 * Uses advisory locks to prevent race conditions
 */
export async function processGroupCreationPayment(
  supabase: SupabaseClient,
  paymentData: {
    reference: string;
    amount: number;
    status: string;
    metadata?: {
      user_id?: string;
      group_id?: string;
      preferred_slot?: number | string;
    };
  }
): Promise<{ success: boolean; message: string; position?: number }> {
  const { reference, amount, metadata, status } = paymentData;

  console.log('[Payment Processor] Processing group creation payment');
  console.log('[Payment Processor] Reference:', reference);
  console.log('[Payment Processor] Status:', status);

  // Try to acquire lock to prevent concurrent processing
  const lockAcquired = await acquirePaymentLock(supabase, reference);
  if (!lockAcquired) {
    console.log('[Payment Processor] Lock not acquired - another process is handling this payment');
    // Check if payment was already processed by the other process
    const userId = metadata?.user_id;
    const groupId = metadata?.group_id;
    if (userId && groupId) {
      const { data: existingMember } = await supabase
        .from('group_members')
        .select('id, position, has_paid_security_deposit')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .maybeSingle();

      if (existingMember?.has_paid_security_deposit) {
        console.log('[Payment Processor] Payment already processed by concurrent request');
        return {
          success: true,
          message: 'Payment already processed',
          position: existingMember.position,
        };
      }
    }
    // If not processed yet, return error to retry
    return {
      success: false,
      message: 'Payment is being processed by another request. Please wait.',
    };
  }

  // Verify payment was successful
  if (status !== 'success') {
    console.error('[Payment Processor] Payment not successful:', status);
    return { success: false, message: 'Payment not successful' };
  }

  const userId = metadata?.user_id;
  const groupId = metadata?.group_id;
  const preferredSlot = metadata?.preferred_slot 
    ? parseInt(String(metadata.preferred_slot), 10) 
    : 1;

  if (!userId || !groupId) {
    console.error('[Payment Processor] Missing required metadata');
    return { success: false, message: 'Missing required metadata' };
  }

  // Get group details
  const { data: group, error: groupError } = await supabase
    .from('groups')
    .select('contribution_amount, security_deposit_amount, total_members, created_by')
    .eq('id', groupId)
    .single();

  if (groupError || !group) {
    console.error('[Payment Processor] Group not found:', groupError);
    return { success: false, message: 'Group not found' };
  }

  // Verify user is the creator
  if (group.created_by !== userId) {
    console.error('[Payment Processor] User is not the group creator');
    return { success: false, message: 'Only the group creator can make this payment' };
  }

  // Verify payment amount
  const requiredAmount = (group.contribution_amount + group.security_deposit_amount) * 100;
  if (amount < requiredAmount) {
    console.error('[Payment Processor] Payment amount insufficient');
    return {
      success: false,
      message: `Insufficient amount. Expected: ₦${requiredAmount / 100}, Received: ₦${amount / 100}`,
    };
  }

  // Check if already processed (idempotency)
  const { data: existingMember } = await supabase
    .from('group_members')
    .select('id, position, has_paid_security_deposit')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existingMember?.has_paid_security_deposit) {
    console.log('[Payment Processor] Already processed (duplicate)');
    return {
      success: true,
      message: 'Payment already processed',
      position: existingMember.position,
    };
  }

  let memberPosition = preferredSlot;

  if (!existingMember) {
    // Add creator as member
    console.log('[Payment Processor] Adding creator as member with slot:', preferredSlot);
    
    const { data: addMemberResult, error: addMemberError } = await supabase
      .rpc('add_member_to_group', {
        p_group_id: groupId,
        p_user_id: userId,
        p_is_creator: true,
        p_preferred_slot: preferredSlot,
      });

    if (addMemberError) {
      console.error('[Payment Processor] Failed to add creator:', addMemberError);
      return { success: false, message: 'Failed to add creator to group' };
    }

    if (addMemberResult && addMemberResult.length > 0) {
      const result = addMemberResult[0];
      if (!result.success) {
        console.error('[Payment Processor] add_member_to_group failed:', result.error_message);
        return { success: false, message: result.error_message || 'Failed to add creator' };
      }
      memberPosition = result.position || preferredSlot;
    }

    // Update payment status
    const { error: memberError } = await supabase
      .from('group_members')
      .update({
        has_paid_security_deposit: true,
        security_deposit_paid_at: new Date().toISOString(),
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('group_id', groupId)
      .eq('user_id', userId);

    if (memberError) {
      console.error('[Payment Processor] Failed to update member:', memberError);
      return { success: false, message: 'Failed to update member payment status' };
    }
  } else {
    memberPosition = existingMember.position;

    // Update existing member
    const { error: memberError } = await supabase
      .from('group_members')
      .update({
        has_paid_security_deposit: true,
        security_deposit_paid_at: new Date().toISOString(),
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('group_id', groupId)
      .eq('user_id', userId);

    if (memberError) {
      console.error('[Payment Processor] Failed to update member:', memberError);
      return { success: false, message: 'Failed to update member payment status' };
    }
  }

  // Create first contribution record
  const { error: contribError } = await supabase
    .from('contributions')
    .upsert({
      group_id: groupId,
      user_id: userId,
      amount: group.contribution_amount,
      cycle_number: FIRST_CYCLE_NUMBER,
      status: 'paid',
      due_date: new Date().toISOString(),
      paid_date: new Date().toISOString(),
      transaction_ref: reference,
    }, {
      onConflict: 'group_id,user_id,cycle_number',
    });

  if (contribError) {
    console.error('[Payment Processor] Failed to create contribution:', contribError);
    // Non-fatal - member is already set up
  }

  // Create transaction records
  await createPaymentTransactions(
    supabase,
    groupId,
    userId,
    reference,
    group.security_deposit_amount,
    group.contribution_amount,
    true
  );

  console.log('[Payment Processor] Group creation payment processed. Position:', memberPosition);
  return {
    success: true,
    message: 'Group creation payment processed successfully',
    position: memberPosition,
  };
}

/**
 * Process group join payment
 * Activates member who already joined or adds new member with payment
 * 
 * Idempotent: Safe to call multiple times
 * Uses advisory locks to prevent race conditions
 */
export async function processGroupJoinPayment(
  supabase: SupabaseClient,
  paymentData: {
    reference: string;
    amount: number;
    status: string;
    metadata?: {
      user_id?: string;
      group_id?: string;
      preferred_slot?: number | string;
    };
  }
): Promise<{ success: boolean; message: string; position?: number }> {
  const { reference, amount, metadata, status } = paymentData;

  console.log('[Payment Processor] Processing group join payment');
  console.log('[Payment Processor] Reference:', reference);
  console.log('[Payment Processor] Status:', status);

  // Try to acquire lock to prevent concurrent processing
  const lockAcquired = await acquirePaymentLock(supabase, reference);
  if (!lockAcquired) {
    console.log('[Payment Processor] Lock not acquired - another process is handling this payment');
    // Check if payment was already processed by the other process
    const userId = metadata?.user_id;
    const groupId = metadata?.group_id;
    if (userId && groupId) {
      const { data: existingMember } = await supabase
        .from('group_members')
        .select('id, position, has_paid_security_deposit')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .maybeSingle();

      if (existingMember?.has_paid_security_deposit) {
        console.log('[Payment Processor] Payment already processed by concurrent request');
        return {
          success: true,
          message: 'Payment already processed',
          position: existingMember.position,
        };
      }
    }
    // If not processed yet, return error to retry
    return {
      success: false,
      message: 'Payment is being processed by another request. Please wait.',
    };
  }

  // Verify payment was successful
  if (status !== 'success') {
    console.error('[Payment Processor] Payment not successful:', status);
    return { success: false, message: 'Payment not successful' };
  }

  const userId = metadata?.user_id;
  const groupId = metadata?.group_id;
  const preferredSlot = metadata?.preferred_slot 
    ? parseInt(String(metadata.preferred_slot), 10) 
    : null;

  if (!userId || !groupId) {
    console.error('[Payment Processor] Missing required metadata');
    return { success: false, message: 'Missing required metadata' };
  }

  // Get group details
  const { data: group, error: groupError } = await supabase
    .from('groups')
    .select('contribution_amount, security_deposit_amount, current_members, max_members')
    .eq('id', groupId)
    .single();

  if (groupError || !group) {
    console.error('[Payment Processor] Group not found:', groupError);
    return { success: false, message: 'Group not found' };
  }

  // Verify payment amount
  const requiredAmount = (group.contribution_amount + group.security_deposit_amount) * 100;
  if (amount < requiredAmount) {
    console.error('[Payment Processor] Payment amount insufficient');
    return {
      success: false,
      message: `Insufficient amount. Expected: ₦${requiredAmount / 100}, Received: ₦${amount / 100}`,
    };
  }

  // Check if user is already a member
  const { data: existingMember } = await supabase
    .from('group_members')
    .select('id, position, has_paid_security_deposit, status')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .maybeSingle();

  let memberPosition: number;

  if (existingMember) {
    // Check if already paid (idempotency)
    if (existingMember.has_paid_security_deposit) {
      console.log('[Payment Processor] Already processed (duplicate)');
      return {
        success: true,
        message: 'Payment already processed',
        position: existingMember.position,
      };
    }

    memberPosition = existingMember.position;

    // Update existing member
    const { error: memberError } = await supabase
      .from('group_members')
      .update({
        has_paid_security_deposit: true,
        security_deposit_paid_at: new Date().toISOString(),
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('group_id', groupId)
      .eq('user_id', userId);

    if (memberError) {
      console.error('[Payment Processor] Failed to update member:', memberError);
      return { success: false, message: 'Failed to update member payment status' };
    }
  } else {
    // Add user as new member
    console.log('[Payment Processor] Adding user as new member');
    
    // Get preferred slot from join request if not in metadata
    let slotToAssign = preferredSlot;
    if (!slotToAssign) {
      const { data: joinRequest } = await supabase
        .from('group_join_requests')
        .select('preferred_slot')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .eq('status', 'approved')
        .maybeSingle();
      
      slotToAssign = joinRequest?.preferred_slot || null;
    }
    
    const { data: addMemberResult, error: addMemberError } = await supabase
      .rpc('add_member_to_group', {
        p_group_id: groupId,
        p_user_id: userId,
        p_is_creator: false,
        p_preferred_slot: slotToAssign,
      });

    if (addMemberError) {
      console.error('[Payment Processor] Failed to add member:', addMemberError);
      return { success: false, message: 'Failed to add user to group' };
    }

    if (!addMemberResult || !Array.isArray(addMemberResult) || addMemberResult.length === 0) {
      console.error('[Payment Processor] add_member_to_group returned no result');
      return { success: false, message: 'Failed to add user to group' };
    }
    
    const result = addMemberResult[0];
    if (!result.success) {
      console.error('[Payment Processor] add_member_to_group failed:', result.error_message);
      return { success: false, message: result.error_message || 'Failed to add user' };
    }

    memberPosition = result.position;

    // Update payment status
    const { error: memberError } = await supabase
      .from('group_members')
      .update({
        has_paid_security_deposit: true,
        security_deposit_paid_at: new Date().toISOString(),
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('group_id', groupId)
      .eq('user_id', userId);

    if (memberError) {
      console.error('[Payment Processor] Failed to update member:', memberError);
      return { success: false, message: 'Failed to update member payment status' };
    }
  }

  // Create first contribution record
  const currentTime = new Date().toISOString();
  const { error: contribError } = await supabase
    .from('contributions')
    .upsert({
      group_id: groupId,
      user_id: userId,
      amount: group.contribution_amount,
      cycle_number: FIRST_CYCLE_NUMBER,
      status: 'paid',
      due_date: currentTime,
      paid_date: currentTime,
      transaction_ref: reference,
      created_at: currentTime,
      updated_at: currentTime,
    }, {
      onConflict: 'group_id,user_id,cycle_number',
    });

  if (contribError) {
    console.error('[Payment Processor] Failed to create contribution:', contribError);
    // Non-fatal - member is already set up
  }

  // Create transaction records
  await createPaymentTransactions(
    supabase,
    groupId,
    userId,
    reference,
    group.security_deposit_amount,
    group.contribution_amount,
    false
  );

  // Update join request status
  await supabase
    .from('group_join_requests')
    .update({
      status: 'joined',
      updated_at: new Date().toISOString(),
    })
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .eq('status', 'approved');

  console.log('[Payment Processor] Group join payment processed. Position:', memberPosition);
  return {
    success: true,
    message: 'Group join payment processed successfully',
    position: memberPosition,
  };
}

/**
 * Process standalone contribution payment
 * Updates contribution status to paid and creates transaction record
 * 
 * Idempotent: Safe to call multiple times
 * Uses advisory locks to prevent race conditions
 */
export async function processContributionPayment(
  supabase: SupabaseClient,
  paymentData: {
    reference: string;
    amount: number;
    status: string;
    metadata?: {
      user_id?: string;
      group_id?: string;
      contribution_id?: string;
    };
  }
): Promise<{ success: boolean; message: string }> {
  const { reference, amount, metadata, status } = paymentData;

  console.log('[Payment Processor] Processing contribution payment');
  console.log('[Payment Processor] Reference:', reference);
  console.log('[Payment Processor] Status:', status);

  // Try to acquire lock to prevent concurrent processing
  const lockAcquired = await acquirePaymentLock(supabase, reference);
  if (!lockAcquired) {
    console.log('[Payment Processor] Lock not acquired - another process is handling this payment');
    // Check if payment was already processed by the other process
    const contributionId = metadata?.contribution_id;
    if (contributionId) {
      const { data: contribution } = await supabase
        .from('contributions')
        .select('status')
        .eq('id', contributionId)
        .maybeSingle();

      if (contribution?.status === 'paid') {
        console.log('[Payment Processor] Payment already processed by concurrent request');
        return {
          success: true,
          message: 'Contribution already processed',
        };
      }
    }
    // If not processed yet, return error to retry
    return {
      success: false,
      message: 'Payment is being processed by another request. Please wait.',
    };
  }

  if (status !== 'success') {
    console.error('[Payment Processor] Invalid payment status:', status);
    return { success: false, message: 'Payment not successful' };
  }

  const contributionId = metadata?.contribution_id;
  const userId = metadata?.user_id;
  const groupId = metadata?.group_id;

  if (!contributionId || !userId || !groupId) {
    console.error('[Payment Processor] Missing required metadata');
    return { success: false, message: 'Invalid payment metadata' };
  }

  // Get contribution details
  const { data: contribution, error: fetchError } = await supabase
    .from('contributions')
    .select('id, user_id, group_id, status, amount, cycle_number')
    .eq('id', contributionId)
    .maybeSingle();

  if (fetchError || !contribution) {
    console.error('[Payment Processor] Contribution not found:', fetchError);
    return { success: false, message: 'Contribution not found' };
  }

  // Verify contribution belongs to user
  if (contribution.user_id !== userId) {
    console.error('[Payment Processor] Contribution user mismatch');
    return { success: false, message: 'Unauthorized: contribution belongs to different user' };
  }

  // Check if already paid (idempotency)
  if (contribution.status === 'paid') {
    console.log('[Payment Processor] Contribution already paid (idempotent)');
    return { 
      success: true, 
      message: 'Contribution already processed' 
    };
  }

  // Update contribution to paid
  const { error: updateError } = await supabase
    .from('contributions')
    .update({
      status: 'paid',
      paid_date: new Date().toISOString(),
      transaction_ref: reference,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contributionId);

  if (updateError) {
    console.error('[Payment Processor] Failed to update contribution:', updateError);
    return { success: false, message: 'Failed to update contribution status' };
  }

  // Create transaction record
  const { error: txError } = await supabase
    .from('transactions')
    .insert({
      user_id: userId,
      group_id: groupId,
      type: 'contribution',
      amount: contribution.amount,
      status: 'completed',
      reference: reference,
      description: `Contribution payment for cycle ${contribution.cycle_number}`,
      completed_at: new Date().toISOString(),
    });

  if (txError) {
    console.error('[Payment Processor] Failed to create transaction:', txError);
    // Non-fatal - contribution is already marked as paid
  }

  // Create notification for user
  const { error: notifError } = await supabase
    .from('notifications')
    .insert({
      user_id: userId,
      type: 'contribution_paid',
      title: 'Contribution Payment Successful',
      message: `Your contribution payment of ₦${(contribution.amount).toLocaleString()} has been processed successfully.`,
      data: {
        contribution_id: contributionId,
        group_id: groupId,
        amount: contribution.amount,
        cycle_number: contribution.cycle_number,
      },
    });

  if (notifError) {
    console.error('[Payment Processor] Failed to create notification:', notifError);
    // Non-fatal: contribution is already paid
  }

  console.log('[Payment Processor] Contribution payment processed successfully');
  return {
    success: true,
    message: 'Contribution payment processed successfully',
  };
}
