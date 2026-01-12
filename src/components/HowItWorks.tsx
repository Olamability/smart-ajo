import { UserPlus, Wallet, Clock, CheckCircle } from "lucide-react";

const steps = [
  {
    icon: UserPlus,
    title: "Join or Create a Group",
    description: "Set your contribution amount, frequency, and invite trusted members. Define the rotation order upfront.",
    color: "primary",
  },
  {
    icon: Wallet,
    title: "Pay Security Deposit",
    description: "Each member pays a one-time security deposit. This ensures commitment and protects against defaults.",
    color: "accent",
  },
  {
    icon: Clock,
    title: "Contribute Monthly",
    description: "Make your contributions on time. The system tracks all payments and waits until everyone has paid.",
    color: "primary",
  },
  {
    icon: CheckCircle,
    title: "Receive Your Payout",
    description: "When it's your turn, receive the full pool minus the 2% service fee. Automatic, guaranteed, and on schedule.",
    color: "success",
  },
];

const HowItWorks = () => {
  return (
    <section id="how-it-works" className="py-20 lg:py-32 bg-secondary/30">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-sm font-semibold text-primary uppercase tracking-wider">How It Works</span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mt-4 mb-6">
            Save Together, Securely
          </h2>
          <p className="text-lg text-muted-foreground">
            Four simple steps to join a rotating savings group with complete peace of mind.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          {steps.map((step, index) => (
            <div
              key={step.title}
              className="relative group"
            >
              {/* Connector line */}
              {index < steps.length - 1 && (
                <div className="hidden lg:block absolute top-12 left-full w-full h-0.5 bg-gradient-to-r from-border to-transparent z-0" />
              )}
              
              <div className="relative bg-card rounded-2xl p-6 shadow-soft hover:shadow-medium transition-all duration-300 border border-border h-full">
                {/* Step number */}
                <div className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-gradient-hero flex items-center justify-center text-sm font-bold text-primary-foreground">
                  {index + 1}
                </div>

                <div className={`w-14 h-14 rounded-xl mb-5 flex items-center justify-center ${
                  step.color === 'primary' ? 'bg-primary/10' :
                  step.color === 'accent' ? 'bg-accent/10' :
                  'bg-success/10'
                }`}>
                  <step.icon className={`w-7 h-7 ${
                    step.color === 'primary' ? 'text-primary' :
                    step.color === 'accent' ? 'text-accent' :
                    'text-success'
                  }`} />
                </div>

                <h3 className="text-xl font-bold text-foreground mb-3">{step.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
