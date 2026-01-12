import { Shield, Lock, Clock, Users, BarChart3, Bell } from "lucide-react";

const features = [
  {
    icon: Shield,
    title: "Escrow Protection",
    description: "All contributions are held securely until everyone pays. No more chasing members for money.",
  },
  {
    icon: Lock,
    title: "Security Deposits",
    description: "Mandatory deposits protect the group. Defaulters lose their deposit, covering any shortfall.",
  },
  {
    icon: Clock,
    title: "Automated Payouts",
    description: "Once all members contribute, payouts happen automatically. No delays, no excuses.",
  },
  {
    icon: Users,
    title: "Transparent Dashboard",
    description: "Track every contribution, see who's paid, and know exactly when your payout is coming.",
  },
  {
    icon: BarChart3,
    title: "Penalty System",
    description: "Late payments incur automatic penalties. Everyone is incentivized to pay on time.",
  },
  {
    icon: Bell,
    title: "Smart Reminders",
    description: "Automatic notifications for upcoming payments and group milestones keep everyone on track.",
  },
];

const FeaturesSection = () => {
  return (
    <section id="features" className="py-20 lg:py-32">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-sm font-semibold text-primary uppercase tracking-wider">Features</span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mt-4 mb-6">
            Built for Trust & Transparency
          </h2>
          <p className="text-lg text-muted-foreground">
            Every feature is designed to eliminate the problems that plague traditional ajo systems.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
          {features.map((feature, index) => (
            <div
              key={feature.title}
              className="group relative bg-card rounded-2xl p-8 shadow-soft hover:shadow-medium transition-all duration-300 border border-border hover:border-primary/30"
              style={{ animationDelay: `${index * 0.1}s` }}
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-6 group-hover:bg-primary/20 transition-colors">
                <feature.icon className="w-6 h-6 text-primary" />
              </div>

              <h3 className="text-xl font-bold text-foreground mb-3">{feature.title}</h3>
              <p className="text-muted-foreground leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
