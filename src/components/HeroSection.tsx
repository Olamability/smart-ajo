import { Button } from "@/components/ui/button";
import { ArrowRight, Shield, Users, Wallet } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const HeroSection = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const handleGetStarted = () => {
    if (isAuthenticated) {
      navigate('/dashboard');
    } else {
      navigate('/signup');
    }
  };

  return (
    <section className="relative pt-32 pb-20 lg:pt-40 lg:pb-32 overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-20 left-1/4 w-72 h-72 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-1/4 w-96 h-96 bg-accent/10 rounded-full blur-3xl" />
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left content */}
          <div className="text-center lg:text-left">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6 animate-fade-up">
              <Shield className="w-4 h-4" />
              <span>Secure & Automated Savings</span>
            </div>
            
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-foreground leading-tight mb-6 animate-fade-up" style={{ animationDelay: '0.1s' }}>
              Traditional Ajo,{' '}
              <span className="text-gradient">Modern Trust</span>
            </h1>
            
            <p className="text-lg sm:text-xl text-muted-foreground max-w-xl mx-auto lg:mx-0 mb-8 animate-fade-up" style={{ animationDelay: '0.2s' }}>
              Join rotating savings groups with complete transparency. Automated escrow, enforced contributions, and guaranteed payouts—no more defaults.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start animate-fade-up" style={{ animationDelay: '0.3s' }}>
              <Button variant="hero" size="xl" onClick={handleGetStarted}>
                Start Saving Today
                <ArrowRight className="w-5 h-5" />
              </Button>
              <Button variant="glass" size="xl" onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}>
                Learn How It Works
              </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-6 mt-12 pt-8 border-t border-border animate-fade-up" style={{ animationDelay: '0.4s' }}>
              <div>
                <p className="text-2xl sm:text-3xl font-bold text-foreground">₦50M+</p>
                <p className="text-sm text-muted-foreground">Savings Protected</p>
              </div>
              <div>
                <p className="text-2xl sm:text-3xl font-bold text-foreground">5,000+</p>
                <p className="text-sm text-muted-foreground">Active Members</p>
              </div>
              <div>
                <p className="text-2xl sm:text-3xl font-bold text-foreground">99.8%</p>
                <p className="text-sm text-muted-foreground">Success Rate</p>
              </div>
            </div>
          </div>

          {/* Right visual */}
          <div className="relative animate-fade-up" style={{ animationDelay: '0.3s' }}>
            <div className="relative bg-gradient-card rounded-3xl p-8 shadow-strong border border-border">
              {/* Mock dashboard */}
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Your Group</p>
                    <p className="text-xl font-bold text-foreground">Lagos Traders Circle</p>
                  </div>
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Users className="w-6 h-6 text-primary" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-secondary rounded-xl p-4">
                    <p className="text-sm text-muted-foreground mb-1">Monthly Contribution</p>
                    <p className="text-2xl font-bold text-foreground">₦50,000</p>
                  </div>
                  <div className="bg-secondary rounded-xl p-4">
                    <p className="text-sm text-muted-foreground mb-1">Your Position</p>
                    <p className="text-2xl font-bold text-foreground">#3 of 10</p>
                  </div>
                </div>

                {/* Progress bar */}
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Cycle Progress</span>
                    <span className="font-medium text-foreground">8/10 Paid</span>
                  </div>
                  <div className="h-3 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full w-4/5 bg-gradient-hero rounded-full" />
                  </div>
                </div>

                {/* Next payout */}
                <div className="flex items-center justify-between p-4 bg-primary/5 rounded-xl border border-primary/20">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-accent flex items-center justify-center">
                      <Wallet className="w-5 h-5 text-accent-foreground" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Next Payout</p>
                      <p className="font-semibold text-foreground">₦500,000</p>
                    </div>
                  </div>
                  <span className="text-sm font-medium text-primary">Dec 20</span>
                </div>
              </div>
            </div>

            {/* Floating elements */}
            <div className="absolute -top-4 -right-4 bg-card rounded-2xl p-4 shadow-medium border border-border animate-float">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center">
                  <Shield className="w-4 h-4 text-success" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Security Deposit</p>
                  <p className="text-sm font-semibold text-success">Secured ✓</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
