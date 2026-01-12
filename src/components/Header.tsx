import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Shield, LogOut, User, Menu, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, useLocation } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const Header = () => {
  const { isAuthenticated, user, logout: authLogout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isLandingPage = location.pathname === '/';
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Check if user is admin
  useEffect(() => {
    const checkAdmin = async () => {
      if (user?.id) {
        const { createClient } = await import('@/lib/client/supabase');
        const supabase = createClient();
        const { data, error } = await supabase
          .from('users')
          .select('is_admin')
          .eq('id', user.id)
          .maybeSingle();
        
        if (!error && data) {
          setIsAdmin(data.is_admin || false);
        }
      }
    };
    
    checkAdmin();
  }, [user]);

  // Close mobile menu on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMobileMenuOpen) {
        setIsMobileMenuOpen(false);
      }
    };

    if (isMobileMenuOpen) {
      document.addEventListener('keydown', handleEscape);
      // Prevent body scroll when menu is open using CSS class
      document.body.classList.add('overflow-hidden');
    } else {
      document.body.classList.remove('overflow-hidden');
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.classList.remove('overflow-hidden');
    };
  }, [isMobileMenuOpen]);

  const handleLogout = async () => {
    await authLogout();
    setIsMobileMenuOpen(false);
    navigate('/');
  };

  const handleLogin = () => {
    setIsMobileMenuOpen(false);
    navigate('/login');
  };

  const handleSignUp = () => {
    setIsMobileMenuOpen(false);
    navigate('/signup');
  };

  const handleDashboard = () => {
    setIsMobileMenuOpen(false);
    navigate('/dashboard');
  };

  const scrollToSection = (id: string) => {
    setIsMobileMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
              <div className="w-9 h-9 rounded-lg bg-gradient-hero flex items-center justify-center">
                <Shield className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="text-xl font-bold text-foreground">Smart Ajo</span>
            </div>
            
            {isLandingPage && (
              <nav className="hidden md:flex items-center gap-8">
                <button onClick={() => scrollToSection('how-it-works')} className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                  How it Works
                </button>
                <button onClick={() => scrollToSection('features')} className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                  Features
                </button>
                <button onClick={() => scrollToSection('security')} className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                  Security
                </button>
              </nav>
            )}

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-3">
              {isAuthenticated ? (
                <>
                  <Button variant="ghost" size="sm" onClick={handleDashboard}>
                    Dashboard
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2">
                        <User className="w-4 h-4" />
                        <span className="hidden sm:inline">{user?.fullName}</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>My Account</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => navigate('/dashboard')}>
                        Dashboard
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/groups')}>
                        My Groups
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate('/profile/settings')}>
                        Profile Settings
                      </DropdownMenuItem>
                      {isAdmin && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => navigate('/admin')}>
                            <Shield className="w-4 h-4 mr-2" />
                            Admin Dashboard
                          </DropdownMenuItem>
                        </>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleLogout}>
                        <LogOut className="w-4 h-4 mr-2" />
                        Logout
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : (
                <>
                  <Button variant="ghost" size="sm" onClick={handleLogin}>
                    Log in
                  </Button>
                  <Button variant="hero" size="sm" onClick={handleSignUp}>
                    Get Started
                  </Button>
                </>
              )}
            </div>

            {/* Mobile Menu Button */}
            <button
              className="md:hidden p-2 rounded-lg hover:bg-accent transition-colors"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label="Toggle menu"
            >
              {isMobileMenuOpen ? (
                <X className="w-6 h-6" />
              ) : (
                <Menu className="w-6 h-6" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 z-40 bg-background/95 backdrop-blur-md md:hidden"
          style={{ top: '64px' }}
        >
          <nav className="container mx-auto px-4 py-6 flex flex-col gap-4">
            {isLandingPage && (
              <>
                <button
                  onClick={() => scrollToSection('how-it-works')}
                  className="text-left py-3 px-4 rounded-lg text-foreground hover:bg-accent transition-colors"
                >
                  How it Works
                </button>
                <button
                  onClick={() => scrollToSection('features')}
                  className="text-left py-3 px-4 rounded-lg text-foreground hover:bg-accent transition-colors"
                >
                  Features
                </button>
                <button
                  onClick={() => scrollToSection('security')}
                  className="text-left py-3 px-4 rounded-lg text-foreground hover:bg-accent transition-colors"
                >
                  Security
                </button>
                <div className="border-t border-border my-2" />
              </>
            )}
            
            {isAuthenticated ? (
              <>
                <div className="py-3 px-4">
                  <p className="text-sm text-muted-foreground">Signed in as</p>
                  <p className="font-medium text-foreground">{user?.fullName}</p>
                </div>
                <Button 
                  variant="ghost" 
                  size="lg" 
                  onClick={handleDashboard}
                  className="justify-start"
                >
                  Dashboard
                </Button>
                <Button 
                  variant="ghost" 
                  size="lg" 
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    navigate('/groups');
                  }}
                  className="justify-start"
                >
                  My Groups
                </Button>
                <div className="border-t border-border my-2" />
                <Button 
                  variant="outline" 
                  size="lg" 
                  onClick={handleLogout}
                  className="justify-start gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="lg" onClick={handleLogin}>
                  Log in
                </Button>
                <Button variant="hero" size="lg" onClick={handleSignUp}>
                  Get Started
                </Button>
              </>
            )}
          </nav>
        </div>
      )}
    </>
  );
};

export default Header;
