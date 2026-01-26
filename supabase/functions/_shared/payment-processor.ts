/**
 * Shared Payment Processing Logic
 * 
 * This module contains the business logic for processing different payment types.
 * It's shared between:
 * - verify-payment Edge Function (primary, synchronous)
 * - paystack-webhook Edge Function (backup, asynchronous)
 * 
 * This ensures both paths execute the same business logic reliably.
 */

// Constants
const FIRST_CYCLE_NUMBER = 1;

/**
 * Helper function to create payment transactions for group payments
 */
export async function createPaymentTransactions(
  supabase: any,
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
        reference: reference + '_SD',
        description: isCreator ? 'Security deposit for group creation' : 'Security deposit for joining group',
        completed_at: new Date().toISOString(),
      },
      {
        user_id: userId,
        group_id: groupId,
        type: 'contribution',
        amount: contributionAmount,
        status: 'completed',
        reference: reference + '_C1',
        description: 'First contribution payment',
        completed_at: new Date().toISOString(),
      },
    ]);

  if (error) {
    console.error('Failed to create transactions:', error);
    return false;
  }
  return true;
}

/**
 * Process group creation payment
 * Adds creator as member with selected slot and updates payment status
 */
export async function processGroupCreationPayment(
  supabase: any,
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

  console.log('=== PROCESS GROUP CREATION PAYMENT START ===');
  console.log('Reference:', reference);
  console.log('Amount:', amount);
  console.log('Status:', status);
  console.log('Metadata:', JSON.stringify(metadata, null, 2));

  // Verify payment was successful
  if (status !== 'success') {
    console.error('Payment status is not success:', status);
    return { success: false, message: 'Payment not successful' };
  }

  const userId = metadata?.user_id;
  const groupId = metadata?.group_id;
  // Parse preferred_slot as integer - Paystack may send it as string
  const preferredSlot = metadata?.preferred_slot ? parseInt(String(metadata.preferred_slot), 10) : 1;

  if (!userId || !groupId) {
    console.error('Missing required metadata:', { userId, groupId, preferredSlot });
    return { success: false, message: 'Missing required metadata for group creation' };
  }

  console.log(`Processing group creation payment for user ${userId} in group ${groupId}, preferred slot: ${preferredSlot}`);

  // Get group details
  const { data: group, error: groupError } = await supabase
    .from('groups')
    .select('contribution_amount, security_deposit_amount, total_members, created_by')
    .eq('id', groupId)
    .single();

  if (groupError || !group) {
    console.error('Group not found:', groupError);
    return { success: false, message: 'Group not found' };
  }

  console.log('Group found:', { 
    contribution_amount: group.contribution_amount, 
    security_deposit_amount: group.security_deposit_amount,
    total_members: group.total_members,
    created_by: group.created_by
  });

  // Verify user is the creator
  if (group.created_by !== userId) {
    console.error('User is not the creator of this group. Creator:', group.created_by, 'User:', userId);
    return { success: false, message: 'Only the group creator can make this payment' };
  }

  // Verify payment amount
  const requiredAmount = (group.contribution_amount + group.security_deposit_amount) * 100;
  if (amount < requiredAmount) {
    return {
      success: false,
      message: `Payment amount insufficient. Expected: ₦${requiredAmount / 100}, Received: ₦${amount / 100}`,
    };
  }

  // Check if user is already a member (idempotency)
  const { data: existingMember } = await supabase
    .from('group_members')
    .select('id, position, has_paid_security_deposit')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existingMember?.has_paid_security_deposit) {
    console.log('Group creation payment already processed for reference:', reference);
    return { 
      success: true, 
      message: 'Payment already processed (duplicate)', 
      position: existingMember.position 
    };
  }

  let memberPosition = preferredSlot;

  if (!existingMember) {
    // Creator is not yet a member - add them with their preferred slot
    console.log(`Adding creator as member with preferred slot ${preferredSlot}`);
    
    // Call add_member_to_group function to add creator
    const { data: addMemberResult, error: addMemberError } = await supabase
      .rpc('add_member_to_group', {
        p_group_id: groupId,
        p_user_id: userId,
        p_is_creator: true,
        p_preferred_slot: preferredSlot
      });

    if (addMemberError) {
      console.error('Failed to add creator as member:', addMemberError);
      return { success: false, message: 'Failed to add creator to group' };
    }

    // Check if the function returned success
    if (addMemberResult && addMemberResult.length > 0) {
      const result = addMemberResult[0];
      if (!result.success) {
        console.error('add_member_to_group failed:', result.error_message);
        return { success: false, message: result.error_message || 'Failed to add creator to group' };
      }
      memberPosition = result.position || preferredSlot;
    }

    // Update the newly added member's payment status
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
      console.error('Failed to update member payment status:', memberError);
      return { success: false, message: 'Failed to update member payment status' };
    }
  } else {
    memberPosition = existingMember.position;

    // Update existing member's payment status
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
      console.error('Failed to update member payment status:', memberError);
      return { success: false, message: 'Failed to update member payment status' };
    }
  }

  // Update or create first contribution record
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
      onConflict: 'group_id,user_id,cycle_number'
    });

  if (contribError) {
    console.error('Failed to update contribution:', contribError);
    // Non-fatal for group creation - member is already set up with payment status
  }

  // Create transaction records
  const txSuccess = await createPaymentTransactions(
    supabase,
    groupId,
    userId,
    reference,
    group.security_deposit_amount,
    group.contribution_amount,
    true // isCreator
  );

  if (!txSuccess) {
    console.error('Failed to create transaction records - payment processed but audit trail incomplete');
  } else {
    console.log('Transaction records created successfully');
  }

  console.log(`Group creation payment processed successfully. Creator assigned to position ${memberPosition}`);
  console.log('=== PROCESS GROUP CREATION PAYMENT END (SUCCESS) ===');
  return { 
    success: true, 
    message: 'Group creation payment processed successfully', 
    position: memberPosition 
  };
}

/**
 * Process group join payment
 * Updates payment status for member who is already added to the group
 */
export async function processGroupJoinPayment(
  supabase: any,
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

  console.log('=== PROCESS GROUP JOIN PAYMENT START ===');
  console.log('Reference:', reference);
  console.log('Amount:', amount);
  console.log('Status:', status);
  console.log('Metadata:', JSON.stringify(metadata, null, 2));

  // Verify payment was successful
  if (status !== 'success') {
    console.error('Payment status is not success:', status);
    return { success: false, message: 'Payment not successful' };
  }

  const userId = metadata?.user_id;
  const groupId = metadata?.group_id;
  // Parse preferred_slot as integer - Paystack may send it as string
  const preferredSlot = metadata?.preferred_slot ? parseInt(String(metadata.preferred_slot), 10) : null;

  if (!userId || !groupId) {
    console.error('Missing required metadata:', { userId, groupId });
    return { success: false, message: 'Missing required metadata for group join' };
  }

  console.log(`Processing group join payment for user ${userId} in group ${groupId}, preferred slot: ${preferredSlot}`);

  // Get group details
  const { data: group, error: groupError } = await supabase
    .from('groups')
    .select('contribution_amount, security_deposit_amount, current_members, max_members')
    .eq('id', groupId)
    .single();

  if (groupError || !group) {
    console.error('Group not found:', groupError);
    return { success: false, message: 'Group not found' };
  }

  // Verify payment amount
  const requiredAmount = (group.contribution_amount + group.security_deposit_amount) * 100;
  if (amount < requiredAmount) {
    return {
      success: false,
      message: `Payment amount insufficient. Expected: ₦${requiredAmount / 100}, Received: ₦${amount / 100}`,
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
    // User is already a member - check if already paid (idempotency)
    if (existingMember.has_paid_security_deposit) {
      console.log('Group join payment already processed for reference:', reference);
      return { 
        success: true, 
        message: 'Payment already processed (duplicate)', 
        position: existingMember.position 
      };
    }

    memberPosition = existingMember.position;

    // Update existing member's payment status
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
      console.error('Failed to update member payment status:', memberError);
      return { success: false, message: 'Failed to update member payment status' };
    }
  } else {
    // User is NOT a member yet - add them now
    console.log(`Adding user as member with payment`);
    
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
    
    // Call add_member_to_group function to add user with their preferred slot
    const { data: addMemberResult, error: addMemberError } = await supabase
      .rpc('add_member_to_group', {
        p_group_id: groupId,
        p_user_id: userId,
        p_is_creator: false,
        p_preferred_slot: slotToAssign
      });

    if (addMemberError) {
      console.error('Failed to add user as member:', addMemberError);
      return { success: false, message: 'Failed to add user to group' };
    }

    // Check if the function returned success
    if (!addMemberResult || !Array.isArray(addMemberResult) || addMemberResult.length === 0) {
      console.error('add_member_to_group returned no result');
      return { success: false, message: 'Failed to add user to group - no result returned' };
    }
    
    const result = addMemberResult[0];
    if (!result.success) {
      console.error('add_member_to_group failed:', result.error_message);
      return { success: false, message: result.error_message || 'Failed to add user to group' };
    }

    memberPosition = result.position;

    // Update the newly added member's payment status
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
      console.error('Failed to update member payment status:', memberError);
      return { success: false, message: 'Failed to update member payment status' };
    }
  }

  // Update or create first contribution record
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
      onConflict: 'group_id,user_id,cycle_number'
    });

  if (contribError) {
    console.error('Failed to update contribution:', contribError);
    // Non-fatal for group join - member payment status is already updated
  }

  // Create transaction records
  const txSuccess = await createPaymentTransactions(
    supabase,
    groupId,
    userId,
    reference,
    group.security_deposit_amount,
    group.contribution_amount,
    false // isCreator
  );

  if (!txSuccess) {
    console.error('Failed to create transaction records - payment processed but audit trail incomplete');
  } else {
    console.log('Transaction records created successfully');
  }

  // Update join request status to 'joined' if it exists
  const { error: joinReqError } = await supabase
    .from('group_join_requests')
    .update({
      status: 'joined',
      updated_at: new Date().toISOString(),
    })
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .eq('status', 'approved');

  if (joinReqError) {
    console.error('Failed to update join request:', joinReqError);
    // Non-fatal
  } else {
    console.log('Join request status updated to joined');
  }

  console.log(`Group join payment processed successfully. Member assigned to position ${memberPosition}`);
  console.log('=== PROCESS GROUP JOIN PAYMENT END (SUCCESS) ===');
  return { 
    success: true, 
    message: 'Group join payment processed successfully', 
    position: memberPosition 
  };
}
