import Header from "@/components/Header";
import HeroSection from "@/components/HeroSection";
import HowItWorks from "@/components/HowItWorks";
import FeaturesSection from "@/components/FeaturesSection";
import SecuritySection from "@/components/SecuritySection";
import TargetUsers from "@/components/TargetUsers";
import CTASection from "@/components/CTASection";
import Footer from "@/components/Footer";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main id="main-content">
        <HeroSection />
        <HowItWorks />
        <FeaturesSection />
        <SecuritySection />
        <TargetUsers />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
}
