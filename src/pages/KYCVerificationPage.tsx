import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { createClient } from '../lib/client/supabase';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { toast } from 'sonner';
import { Shield, CheckCircle, XCircle, AlertTriangle, Loader2 } from 'lucide-react';

export default function KYCVerificationPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const supabase = createClient();

  const [loading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [formData, setFormData] = useState({
    bvn: '',
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    phoneNumber: '',
  });
  const [verificationResult, setVerificationResult] = useState<{
    verified: boolean;
    message: string;
  } | null>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate form
    if (!formData.bvn || !formData.firstName || !formData.lastName || !formData.dateOfBirth) {
      toast.error('Please fill in all required fields');
      return;
    }

    // Validate BVN format (11 digits)
    if (!/^\d{11}$/.test(formData.bvn)) {
      toast.error('BVN must be exactly 11 digits');
      return;
    }

    setVerifying(true);
    setVerificationResult(null);

    try {
      // Get auth token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('You must be logged in to verify your identity');
        return;
      }

      // Call BVN verification Edge Function
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/verify-bvn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          bvn: formData.bvn,
          firstName: formData.firstName,
          lastName: formData.lastName,
          dateOfBirth: formData.dateOfBirth,
          phoneNumber: formData.phoneNumber,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Verification failed');
      }

      const result = await response.json();

      setVerificationResult({
        verified: result.verified,
        message: result.message,
      });

      if (result.verified) {
        toast.success('Identity verified successfully!');
        // Refresh user data
        setTimeout(() => {
          navigate('/dashboard');
        }, 2000);
      } else {
        toast.error(result.message || 'Verification failed. Please check your details and try again.');
      }
    } catch (error: any) {
      console.error('KYC verification error:', error);
      toast.error(error.message || 'Failed to verify identity. Please try again.');
      setVerificationResult({
        verified: false,
        message: error.message || 'Verification failed',
      });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <div className="mb-8 text-center">
        <div className="flex justify-center mb-4">
          <div className="bg-primary/10 p-4 rounded-full">
            <Shield className="h-12 w-12 text-primary" />
          </div>
        </div>
        <h1 className="text-3xl font-bold">KYC Verification</h1>
        <p className="text-muted-foreground mt-2">
          Verify your identity to unlock all features
        </p>
      </div>

      {verificationResult && (
        <Card className={`mb-6 ${verificationResult.verified ? 'border-green-500' : 'border-red-500'}`}>
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              {verificationResult.verified ? (
                <CheckCircle className="h-6 w-6 text-green-500 flex-shrink-0" />
              ) : (
                <XCircle className="h-6 w-6 text-red-500 flex-shrink-0" />
              )}
              <div>
                <h3 className={`font-semibold ${verificationResult.verified ? 'text-green-700' : 'text-red-700'}`}>
                  {verificationResult.verified ? 'Verification Successful' : 'Verification Failed'}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {verificationResult.message}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>BVN Verification</CardTitle>
          <CardDescription>
            Enter your Bank Verification Number (BVN) and personal details to verify your identity.
            Your BVN is used only for verification and is kept secure.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="bvn">Bank Verification Number (BVN) *</Label>
              <Input
                id="bvn"
                name="bvn"
                type="text"
                placeholder="Enter your 11-digit BVN"
                maxLength={11}
                value={formData.bvn}
                onChange={handleInputChange}
                disabled={verifying}
                required
              />
              <p className="text-xs text-muted-foreground">
                Dial *565*0# from your phone to get your BVN
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  name="firstName"
                  type="text"
                  placeholder="As on your bank account"
                  value={formData.firstName}
                  onChange={handleInputChange}
                  disabled={verifying}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  name="lastName"
                  type="text"
                  placeholder="As on your bank account"
                  value={formData.lastName}
                  onChange={handleInputChange}
                  disabled={verifying}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dateOfBirth">Date of Birth *</Label>
              <Input
                id="dateOfBirth"
                name="dateOfBirth"
                type="date"
                value={formData.dateOfBirth}
                onChange={handleInputChange}
                disabled={verifying}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phoneNumber">Phone Number (Optional)</Label>
              <Input
                id="phoneNumber"
                name="phoneNumber"
                type="tel"
                placeholder="080XXXXXXXX"
                value={formData.phoneNumber}
                onChange={handleInputChange}
                disabled={verifying}
              />
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-900">
                  <p className="font-semibold mb-1">Privacy Notice</p>
                  <ul className="list-disc list-inside space-y-1 text-blue-800">
                    <li>Your BVN is encrypted and stored securely</li>
                    <li>We only use it for identity verification</li>
                    <li>Your information is never shared with third parties</li>
                    <li>This process is required for financial compliance</li>
                  </ul>
                </div>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={verifying}>
              {verifying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <Shield className="h-4 w-4 mr-2" />
                  Verify Identity
                </>
              )}
            </Button>

            <p className="text-xs text-center text-muted-foreground">
              Having trouble? Contact our support team for assistance.
            </p>
          </form>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-lg">Why KYC Verification?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">Enhanced Security:</strong> Protects all members from fraud and ensures only verified users participate.
          </p>
          <p>
            <strong className="text-foreground">Regulatory Compliance:</strong> Required by Nigerian financial regulations for savings platforms.
          </p>
          <p>
            <strong className="text-foreground">Higher Trust:</strong> Verified members can join premium groups with higher contribution limits.
          </p>
          <p>
            <strong className="text-foreground">Dispute Resolution:</strong> Helps resolve any issues quickly with verified identity records.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
