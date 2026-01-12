import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { 
  getUserProfile, 
  updateUserProfile, 
  uploadAvatar,
  deleteAvatar,
  changePassword,
  deactivateAccount,
  NIGERIAN_BANKS 
} from '@/api';
import type { User } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  ArrowLeft,
  User as UserIcon,
  Building2,
  Loader2,
  Save,
  AlertCircle,
  CheckCircle,
  Camera,
  Trash2,
  Lock,
  UserX,
} from 'lucide-react';
import { toast } from 'sonner';

// Profile form schema
const profileSchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters'),
  phone: z.string().regex(/^(\+234|0)[789]\d{9}$/, 'Invalid Nigerian phone number'),
  address: z.string().optional(),
  dateOfBirth: z.string().optional(),
});

// Bank account form schema
const bankAccountSchema = z.object({
  bankName: z.string().min(1, 'Please select a bank'),
  bankCode: z.string().min(1, 'Bank code is required'),
  accountNumber: z.string().regex(/^\d{10}$/, 'Account number must be exactly 10 digits'),
  accountName: z.string().min(2, 'Account name is required'),
});

// Password change form schema
const passwordSchema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().min(8, 'Password must be at least 8 characters'),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type ProfileFormData = z.infer<typeof profileSchema>;
type BankAccountFormData = z.infer<typeof bankAccountSchema>;
type PasswordFormData = z.infer<typeof passwordSchema>;

export default function ProfileSettingsPage() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profileData, setProfileData] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState('profile');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Profile form
  const profileForm = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      fullName: '',
      phone: '',
      address: '',
      dateOfBirth: '',
    },
  });

  // Bank account form
  const bankForm = useForm<BankAccountFormData>({
    resolver: zodResolver(bankAccountSchema),
    defaultValues: {
      bankName: '',
      bankCode: '',
      accountNumber: '',
      accountName: '',
    },
  });

  // Password form
  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      newPassword: '',
      confirmPassword: '',
    },
  });

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getUserProfile();
      if (result.success && result.user) {
        setProfileData(result.user);
        
        // Update profile form
        profileForm.reset({
          fullName: result.user.fullName || '',
          phone: result.user.phone || '',
          address: result.user.address || '',
          dateOfBirth: result.user.dateOfBirth || '',
        });

        // Update bank form if bank details exist
        if (result.user.bankName) {
          bankForm.reset({
            bankName: result.user.bankName || '',
            bankCode: result.user.bankCode || '',
            accountNumber: result.user.accountNumber || '',
            accountName: result.user.accountName || '',
          });
        }
      } else {
        toast.error(result.error || 'Failed to load profile');
      }
    } catch (error) {
      console.error('Error loading profile:', error);
      toast.error('Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [profileForm, bankForm]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const onProfileSubmit = async (data: ProfileFormData) => {
    setSaving(true);
    try {
      const result = await updateUserProfile({
        fullName: data.fullName,
        phone: data.phone,
        address: data.address,
        dateOfBirth: data.dateOfBirth,
      });

      if (result.success) {
        toast.success('Profile updated successfully');
        await loadProfile();
      } else {
        toast.error(result.error || 'Failed to update profile');
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      toast.error('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const onBankAccountSubmit = async (data: BankAccountFormData) => {
    setSaving(true);
    try {
      const result = await updateUserProfile({
        bankAccount: {
          bankName: data.bankName,
          bankCode: data.bankCode,
          accountNumber: data.accountNumber,
          accountName: data.accountName,
        },
      });

      if (result.success) {
        toast.success('Bank account details updated successfully');
        await loadProfile();
        // Refresh AuthContext to update user state globally
        await refreshUser();
      } else {
        toast.error(result.error || 'Failed to update bank account');
      }
    } catch (error) {
      console.error('Error updating bank account:', error);
      toast.error('Failed to update bank account');
    } finally {
      setSaving(false);
    }
  };

  const handleBankSelection = (bankName: string) => {
    const bank = NIGERIAN_BANKS.find(b => b.name === bankName);
    if (bank) {
      bankForm.setValue('bankName', bank.name);
      bankForm.setValue('bankCode', bank.code);
    }
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setAvatarUploading(true);
    try {
      const result = await uploadAvatar(file);
      if (result.success) {
        toast.success('Profile picture updated successfully');
        await loadProfile();
      } else {
        toast.error(result.error || 'Failed to upload profile picture');
      }
    } catch (error) {
      console.error('Error uploading avatar:', error);
      toast.error('Failed to upload profile picture');
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleAvatarDelete = async () => {
    setAvatarUploading(true);
    try {
      const result = await deleteAvatar();
      if (result.success) {
        toast.success('Profile picture removed successfully');
        await loadProfile();
      } else {
        toast.error(result.error || 'Failed to remove profile picture');
      }
    } catch (error) {
      console.error('Error deleting avatar:', error);
      toast.error('Failed to remove profile picture');
    } finally {
      setAvatarUploading(false);
    }
  };

  const onPasswordSubmit = async (data: PasswordFormData) => {
    setSaving(true);
    try {
      const result = await changePassword(data.newPassword);
      if (result.success) {
        toast.success('Password changed successfully');
        passwordForm.reset();
      } else {
        toast.error(result.error || 'Failed to change password');
      }
    } catch (error) {
      console.error('Error changing password:', error);
      toast.error('Failed to change password');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivateAccount = async () => {
    setSaving(true);
    try {
      const result = await deactivateAccount();
      if (result.success) {
        toast.success('Account deactivated successfully. You will be signed out.');
        setTimeout(() => navigate('/'), 2000);
      } else {
        toast.error(result.error || 'Failed to deactivate account');
      }
    } catch (error) {
      console.error('Error deactivating account:', error);
      toast.error('Failed to deactivate account');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/dashboard')}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">Profile Settings</h1>
            <p className="text-muted-foreground">
              Manage your profile and bank account details
            </p>
          </div>
        </div>

        {/* Alert about bank account importance */}
        {!profileData?.accountNumber && (
          <Alert className="bg-amber-50 border-amber-200">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-900">
              <strong>Important:</strong> You need to add your bank account details to receive payouts from groups.
            </AlertDescription>
          </Alert>
        )}

        {profileData?.accountNumber && (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-900">
              Your bank account is configured. You can receive payouts from groups.
            </AlertDescription>
          </Alert>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
            <TabsTrigger value="profile" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
              <UserIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Profile</span>
              <span className="sm:hidden">Prof</span>
            </TabsTrigger>
            <TabsTrigger value="bank" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
              <Building2 className="w-4 h-4" />
              <span className="hidden sm:inline">Bank Account</span>
              <span className="sm:hidden">Bank</span>
            </TabsTrigger>
            <TabsTrigger value="security" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
              <Lock className="w-4 h-4" />
              <span className="hidden sm:inline">Security</span>
              <span className="sm:hidden">Sec</span>
            </TabsTrigger>
            <TabsTrigger value="account" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
              <UserX className="w-4 h-4" />
              <span className="hidden sm:inline">Account</span>
              <span className="sm:hidden">Acct</span>
            </TabsTrigger>
          </TabsList>

          {/* Profile Tab */}
          <TabsContent value="profile">
            <Card>
              <CardHeader>
                <CardTitle>Personal Information</CardTitle>
                <CardDescription>
                  Update your personal details and contact information
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Avatar Upload Section */}
                <div className="flex items-center gap-6 mb-6 pb-6 border-b">
                  <Avatar className="h-24 w-24">
                    <AvatarImage src={profileData?.profileImage} alt={profileData?.fullName} />
                    <AvatarFallback className="text-2xl">
                      {profileData?.fullName?.charAt(0).toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={avatarUploading}
                      >
                        {avatarUploading ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Uploading...
                          </>
                        ) : (
                          <>
                            <Camera className="w-4 h-4 mr-2" />
                            Upload Photo
                          </>
                        )}
                      </Button>
                      {profileData?.profileImage && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleAvatarDelete}
                          disabled={avatarUploading}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Remove
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      JPG, PNG, WEBP or GIF. Max size 2MB.
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      onChange={handleAvatarUpload}
                      className="hidden"
                    />
                  </div>
                </div>

                <form onSubmit={profileForm.handleSubmit(onProfileSubmit)} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="fullName">Full Name</Label>
                    <Input
                      id="fullName"
                      {...profileForm.register('fullName')}
                      placeholder="John Doe"
                    />
                    {profileForm.formState.errors.fullName && (
                      <p className="text-sm text-destructive">
                        {profileForm.formState.errors.fullName.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone Number</Label>
                    <Input
                      id="phone"
                      {...profileForm.register('phone')}
                      placeholder="+2348012345678"
                    />
                    {profileForm.formState.errors.phone && (
                      <p className="text-sm text-destructive">
                        {profileForm.formState.errors.phone.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <Input
                      id="email"
                      value={profileData?.email || ''}
                      disabled
                      className="bg-muted"
                    />
                    <p className="text-xs text-muted-foreground">
                      Email cannot be changed
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="address">Address (Optional)</Label>
                    <Input
                      id="address"
                      {...profileForm.register('address')}
                      placeholder="123 Main Street, Lagos"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="dateOfBirth">Date of Birth (Optional)</Label>
                    <Input
                      id="dateOfBirth"
                      type="date"
                      {...profileForm.register('dateOfBirth')}
                    />
                  </div>

                  <Button type="submit" disabled={saving} className="w-full">
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        Save Profile
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Bank Account Tab */}
          <TabsContent value="bank">
            <Card>
              <CardHeader>
                <CardTitle>Bank Account Details</CardTitle>
                <CardDescription>
                  Add your bank account to receive payouts from groups. This information is required to participate in groups and receive your rotational payouts.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={bankForm.handleSubmit(onBankAccountSubmit)} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="bankName">Bank Name</Label>
                    <Select
                      value={bankForm.watch('bankName')}
                      onValueChange={handleBankSelection}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select your bank" />
                      </SelectTrigger>
                      <SelectContent>
                        {NIGERIAN_BANKS.map((bank) => (
                          <SelectItem key={bank.code} value={bank.name}>
                            {bank.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {bankForm.formState.errors.bankName && (
                      <p className="text-sm text-destructive">
                        {bankForm.formState.errors.bankName.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="accountNumber">Account Number</Label>
                    <Input
                      id="accountNumber"
                      {...bankForm.register('accountNumber')}
                      placeholder="0123456789"
                      maxLength={10}
                    />
                    {bankForm.formState.errors.accountNumber && (
                      <p className="text-sm text-destructive">
                        {bankForm.formState.errors.accountNumber.message}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Enter your 10-digit account number
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="accountName">Account Name</Label>
                    <Input
                      id="accountName"
                      {...bankForm.register('accountName')}
                      placeholder="JOHN DOE"
                    />
                    {bankForm.formState.errors.accountName && (
                      <p className="text-sm text-destructive">
                        {bankForm.formState.errors.accountName.message}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Enter the name on your bank account (should match your bank records)
                    </p>
                  </div>

                  <Alert className="bg-blue-50 border-blue-200">
                    <AlertCircle className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-blue-900 text-sm">
                      <strong>Note:</strong> Make sure your account details are correct. 
                      Incorrect details may result in failed payouts.
                    </AlertDescription>
                  </Alert>

                  <Button type="submit" disabled={saving} className="w-full">
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        Save Bank Account
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Security Tab */}
          <TabsContent value="security">
            <Card>
              <CardHeader>
                <CardTitle>Security Settings</CardTitle>
                <CardDescription>
                  Change your password and manage security settings
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="newPassword">New Password</Label>
                    <Input
                      id="newPassword"
                      type="password"
                      {...passwordForm.register('newPassword')}
                      placeholder="Enter new password"
                    />
                    {passwordForm.formState.errors.newPassword && (
                      <p className="text-sm text-destructive">
                        {passwordForm.formState.errors.newPassword.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirm New Password</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      {...passwordForm.register('confirmPassword')}
                      placeholder="Confirm new password"
                    />
                    {passwordForm.formState.errors.confirmPassword && (
                      <p className="text-sm text-destructive">
                        {passwordForm.formState.errors.confirmPassword.message}
                      </p>
                    )}
                  </div>

                  <Alert className="bg-blue-50 border-blue-200">
                    <AlertCircle className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-blue-900 text-sm">
                      <strong>Password Requirements:</strong> Minimum 8 characters. Choose a strong password you haven't used elsewhere.
                    </AlertDescription>
                  </Alert>

                  <Button type="submit" disabled={saving} className="w-full">
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        Changing Password...
                      </>
                    ) : (
                      <>
                        <Lock className="w-4 h-4 mr-2" />
                        Change Password
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Account Management Tab */}
          <TabsContent value="account">
            <Card>
              <CardHeader>
                <CardTitle>Account Management</CardTitle>
                <CardDescription>
                  Manage your account settings and deactivation
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold mb-2">Deactivate Account</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Deactivating your account will prevent you from logging in and accessing your data. 
                      You must leave or complete all active groups before deactivating.
                    </p>
                  </div>

                  <Alert className="bg-red-50 border-red-200">
                    <AlertCircle className="h-4 w-4 text-red-600" />
                    <AlertDescription className="text-red-900">
                      <strong>Warning:</strong> This action will deactivate your account. 
                      Your data will be preserved but you won't be able to log in. 
                      Contact support to reactivate your account.
                    </AlertDescription>
                  </Alert>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" disabled={saving}>
                        <UserX className="w-4 h-4 mr-2" />
                        Deactivate Account
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will deactivate your account and sign you out. You won't be able to log in 
                          until you contact support to reactivate your account. Make sure you've left all 
                          active groups before proceeding.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleDeactivateAccount}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {saving ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin mr-2" />
                              Deactivating...
                            </>
                          ) : (
                            'Deactivate Account'
                          )}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
