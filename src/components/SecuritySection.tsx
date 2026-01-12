import { Shield, CheckCircle2 } from "lucide-react";

const securityPoints = [
  "Bank-grade encryption protects all transactions",
  "Security deposits ensure member commitment",
  "Automatic penalties deter late payments",
  "Transparent ledger visible to all members",
  "Dispute resolution system for edge cases",
  "Verified identity for all participants",
];

const SecuritySection = () => {
  return (
    <section id="security" className="py-20 lg:py-32 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-hero opacity-[0.03] -z-10" />
      
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* Left content */}
          <div>
            <span className="text-sm font-semibold text-primary uppercase tracking-wider">Security First</span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mt-4 mb-6">
              Your Money is Safe With Us
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              We've engineered every aspect of the platform to eliminate trust issues and protect your savings. The system enforces what traditional organizers couldn't.
            </p>

            <ul className="space-y-4">
              {securityPoints.map((point) => (
                <li key={point} className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                  <span className="text-foreground">{point}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Right visual */}
          <div className="relative">
            <div className="relative bg-card rounded-3xl p-8 lg:p-12 shadow-strong border border-border">
              <div className="flex flex-col items-center text-center">
                <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center mb-6 shadow-glow animate-pulse-soft">
                  <Shield className="w-12 h-12 text-primary" />
                </div>
                
                <h3 className="text-2xl font-bold text-foreground mb-3">100% Protected</h3>
                <p className="text-muted-foreground mb-8">
                  Every naira is held in secure escrow until payout conditions are met.
                </p>

                {/* Trust indicators */}
                <div className="grid grid-cols-2 gap-4 w-full">
                  <div className="bg-secondary rounded-xl p-4 text-center">
                    <p className="text-3xl font-bold text-foreground">0</p>
                    <p className="text-sm text-muted-foreground">Defaults in 2024</p>
                  </div>
                  <div className="bg-secondary rounded-xl p-4 text-center">
                    <p className="text-3xl font-bold text-foreground">100%</p>
                    <p className="text-sm text-muted-foreground">On-time Payouts</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Decorative elements */}
            <div className="absolute -top-6 -left-6 w-12 h-12 bg-accent/20 rounded-full blur-xl" />
            <div className="absolute -bottom-8 -right-8 w-20 h-20 bg-primary/20 rounded-full blur-xl" />
          </div>
        </div>
      </div>
    </section>
  );
};

export default SecuritySection;
