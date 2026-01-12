import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const CTASection = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const handleCreateGroup = () => {
    if (isAuthenticated) {
      navigate('/create-group');
    } else {
      navigate('/signup');
    }
  };

  const handleJoinGroup = () => {
    if (isAuthenticated) {
      navigate('/groups');
    } else {
      navigate('/signup');
    }
  };

  return (
    <section className="py-20 lg:py-32">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative bg-gradient-hero rounded-3xl p-10 lg:p-16 text-center overflow-hidden">
          {/* Background decoration */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-0 left-1/4 w-40 h-40 bg-card rounded-full blur-3xl" />
            <div className="absolute bottom-0 right-1/4 w-60 h-60 bg-card rounded-full blur-3xl" />
          </div>

          <div className="relative z-10">
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-primary-foreground mb-6">
              Ready to Start Saving?
            </h2>
            <p className="text-lg text-primary-foreground/80 max-w-2xl mx-auto mb-10">
              Join thousands of Nigerians who trust Smart Ajo for their rotating savings. 
              Create a group or join one today—it's free to get started.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button variant="accent" size="xl" onClick={handleCreateGroup}>
                Create Your First Group
                <ArrowRight className="w-5 h-5" />
              </Button>
              <Button 
                size="xl" 
                className="bg-primary-foreground/10 text-primary-foreground border border-primary-foreground/20 hover:bg-primary-foreground/20"
                onClick={handleJoinGroup}
              >
                Join an Existing Group
              </Button>
            </div>

            <p className="mt-8 text-sm text-primary-foreground/60">
              Only 2% service fee per cycle • No hidden charges • Cancel anytime
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CTASection;
