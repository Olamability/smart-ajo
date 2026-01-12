import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, Home, ArrowLeft } from 'lucide-react';

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center mb-4">
            <div className="w-12 h-12 rounded-lg bg-gradient-hero flex items-center justify-center">
              <Shield className="w-6 h-6 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-6xl text-center font-bold text-gradient">
            404
          </CardTitle>
          <CardDescription className="text-center text-lg">
            Page Not Found
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            The page you're looking for doesn't exist or has been moved.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 w-full">
            <Button
              variant="outline"
              className="flex-1 gap-2"
              onClick={() => navigate(-1)}
            >
              <ArrowLeft className="w-4 h-4" />
              Go Back
            </Button>
            <Button
              className="flex-1 gap-2"
              onClick={() => navigate('/')}
            >
              <Home className="w-4 h-4" />
              Go Home
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
