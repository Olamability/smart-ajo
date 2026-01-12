// Core type definitions for Smart Ajo platform

export interface User {
  id: string;
  email: string;
  phone: string;
  fullName: string;
  createdAt: string;
  isVerified: boolean;
  isActive?: boolean;
  isAdmin?: boolean;
  kycStatus: 'not_started' | 'pending' | 'verified' | 'rejected'; // 'verified' in app, 'approved' in DB
  kycData?: Record<string, string | number | boolean | null>;
  bvn?: string;
  profileImage?: string;
  dateOfBirth?: string;
  address?: string;
  updatedAt?: string;
  lastLoginAt?: string;
  // Bank Account Details for Payouts
  bankName?: string;
  accountNumber?: string;
  accountName?: string;
  bankCode?: string;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  creatorProfileImage?: string;
  creatorPhone?: string;
  contributionAmount: number;
  frequency: 'daily' | 'weekly' | 'monthly';
  totalMembers: number;
  currentMembers: number;
  securityDepositAmount: number;
  securityDepositPercentage: number; // Percentage of contribution
  status: 'forming' | 'active' | 'paused' | 'completed' | 'cancelled';
  createdAt: string;
  updatedAt?: string;
  startDate?: string;
  endDate?: string;
  currentCycle: number;
  totalCycles: number;
  rotationOrder: string[]; // Array of user IDs
  members: GroupMember[];
  serviceFeePercentage: number; // Default 2%
}

export interface GroupMember {
  userId: string;
  userName: string;
  joinedAt: string;
  rotationPosition: number;
  securityDepositPaid: boolean;
  securityDepositAmount: number;
  status: 'pending' | 'active' | 'suspended' | 'removed'; // Match database schema
  totalContributions: number;
  totalPenalties: number;
  hasReceivedPayout: boolean;
  payoutDate?: string;
  payoutAmount?: number;
}

export interface PayoutSlot {
  id: string;
  groupId: string;
  slotNumber: number;
  payoutCycle: number;
  status: 'available' | 'reserved' | 'assigned';
  assignedTo?: string;
  assignedAt?: string;
  reservedBy?: string;
  reservedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface JoinRequest {
  id: string;
  groupId: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  status: 'pending' | 'approved' | 'rejected';
  message?: string;
  preferredSlot?: number;
  reviewedBy?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Contribution {
  id: string;
  groupId: string;
  userId: string;
  amount: number;
  cycleNumber: number;
  status: 'pending' | 'paid' | 'overdue' | 'waived'; // Match database schema
  dueDate: string;
  paidDate?: string;
  penalty: number;
  serviceFee: number;
  isOverdue?: boolean;
  transactionRef?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Payout {
  id: string;
  relatedGroupId: string; // SQL: related_group_id
  recipientId: string; // SQL: recipient_id
  cycleNumber: number;
  amount: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  payoutDate?: string;
  paymentMethod?: string;
  paymentReference?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Transaction {
  id: string;
  userId: string;
  groupId: string;
  type: 'contribution' | 'payout' | 'security_deposit' | 'penalty' | 'refund';
  amount: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'; // Match database schema
  date: string;
  description: string;
  reference: string;
}

export interface Penalty {
  id: string;
  groupId: string;
  userId: string;
  contributionId: string;
  amount: number;
  type: 'late_payment' | 'missed_payment' | 'early_exit'; // SQL: type field
  status: 'applied' | 'paid' | 'waived'; // Match database schema
  appliedAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: 
    | 'payment_due' 
    | 'payment_received' 
    | 'payment_overdue' 
    | 'payout_ready' 
    | 'payout_processed' 
    | 'penalty_applied' 
    | 'group_complete' 
    | 'group_started' 
    | 'member_joined' 
    | 'member_removed' 
    | 'system_announcement';
  title: string;
  message: string;
  isRead: boolean; // SQL: is_read
  readAt?: string;
  createdAt: string;
  relatedGroupId?: string; // SQL: related_group_id
  relatedTransactionId?: string; // SQL: related_transaction_id
}

// Form types
export interface CreateGroupFormData {
  name: string;
  description: string;
  contributionAmount: number;
  frequency: 'daily' | 'weekly' | 'monthly';
  totalMembers: number;
  securityDepositPercentage: number;
  startDate: string;
}

export interface SignUpFormData {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
}

export interface LoginFormData {
  email: string;
  password: string;
}

export interface KYCFormData {
  bvn: string;
  dateOfBirth: string;
  address: string;
}

// ============================================================================
// SYSTEM ADMIN TYPES
// ============================================================================

export interface AdminUser {
  id: string;
  email: string;
  phone: string;
  full_name: string;
  is_verified: boolean;
  is_active: boolean;
  is_admin: boolean;
  kyc_status: string;
  created_at: string;
  last_login_at: string | null;
  total_groups: number;
  total_contributions: number;
}

export interface AdminGroup {
  id: string;
  name: string;
  description: string;
  created_by: string;
  creator_name: string;
  creator_email: string;
  contribution_amount: number;
  frequency: string;
  total_members: number;
  current_members: number;
  status: string;
  current_cycle: number;
  total_cycles: number;
  created_at: string;
  start_date: string | null;
  total_contributions_paid: number;
  total_amount_collected: number;
}

export interface AdminAnalytics {
  total_users: number;
  active_users: number;
  verified_users: number;
  total_groups: number;
  active_groups: number;
  forming_groups: number;
  completed_groups: number;
  total_contributions: number;
  paid_contributions: number;
  overdue_contributions: number;
  total_amount_collected: number;
  total_payouts: number;
  completed_payouts: number;
  total_penalties: number;
  total_penalty_amount: number;
  users_with_kyc: number;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, any>;
  ip_address: string | null;
  created_at: string;
}

export interface UserDetails extends AdminUser {
  kyc_data: Record<string, any>;
  avatar_url: string | null;
  date_of_birth: string | null;
  address: string | null;
  updated_at: string;
  active_groups: number;
  paid_contributions: number;
  total_contributed_amount: number;
  total_penalties: number;
  total_penalty_amount: number;
}
