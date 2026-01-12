import { Briefcase, Store, GraduationCap, Building2 } from "lucide-react";

const userTypes = [
  {
    icon: Briefcase,
    title: "Salary Earners",
    description: "Save a portion of your monthly income and receive a lump sum when you need it most.",
  },
  {
    icon: Store,
    title: "Traders & Merchants",
    description: "Fund inventory purchases or expand your business with predictable savings cycles.",
  },
  {
    icon: GraduationCap,
    title: "Students",
    description: "Start building financial discipline early with smaller contribution amounts.",
  },
  {
    icon: Building2,
    title: "Cooperatives",
    description: "Manage group savings for organizations with full transparency and accountability.",
  },
];

const TargetUsers = () => {
  return (
    <section className="py-20 lg:py-32 bg-secondary/30">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-sm font-semibold text-primary uppercase tracking-wider">Who It's For</span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mt-4 mb-6">
            Designed for Everyone
          </h2>
          <p className="text-lg text-muted-foreground">
            Whether you're saving for a goal or building financial discipline, Ajo works for you.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {userTypes.map((user) => (
            <div
              key={user.title}
              className="bg-card rounded-2xl p-6 text-center shadow-soft hover:shadow-medium transition-all duration-300 border border-border hover:-translate-y-1"
            >
              <div className="w-16 h-16 rounded-2xl bg-gradient-hero mx-auto flex items-center justify-center mb-5">
                <user.icon className="w-8 h-8 text-primary-foreground" />
              </div>
              <h3 className="text-lg font-bold text-foreground mb-2">{user.title}</h3>
              <p className="text-sm text-muted-foreground">{user.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TargetUsers;
