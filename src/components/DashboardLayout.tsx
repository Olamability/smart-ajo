import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  LayoutDashboard,
  Users,
  Wallet,
  ArrowLeftRight,
  Bell,
  Compass,
  UserCircle,
  Settings,
  LogOut,
  Shield,
  Menu,
  Plus,
  ChevronRight,
} from 'lucide-react';

export type DashboardSection =
  | 'overview'
  | 'groups'
  | 'wallet'
  | 'transactions'
  | 'discover'
  | 'notifications'
  | 'profile';

interface NavItem {
  id: DashboardSection;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

interface DashboardLayoutProps {
  activeSection: DashboardSection;
  onSectionChange: (section: DashboardSection) => void;
  children: React.ReactNode;
  notificationCount?: number;
  overdueCount?: number;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="w-5 h-5" /> },
  { id: 'groups', label: 'My Groups', icon: <Users className="w-5 h-5" /> },
  { id: 'wallet', label: 'Wallet', icon: <Wallet className="w-5 h-5" /> },
  { id: 'transactions', label: 'Transactions', icon: <ArrowLeftRight className="w-5 h-5" /> },
  { id: 'discover', label: 'Discover', icon: <Compass className="w-5 h-5" /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell className="w-5 h-5" /> },
  { id: 'profile', label: 'Profile', icon: <UserCircle className="w-5 h-5" /> },
];

function SidebarContent({
  activeSection,
  onSectionChange,
  notificationCount = 0,
  overdueCount = 0,
  onClose,
}: {
  activeSection: DashboardSection;
  onSectionChange: (section: DashboardSection) => void;
  notificationCount?: number;
  overdueCount?: number;
  onClose?: () => void;
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleNav = (section: DashboardSection) => {
    onSectionChange(section);
    onClose?.();
  };

  const handleLogout = async () => {
    onClose?.();
    await logout();
    navigate('/login', { replace: true });
  };

  const initials = user?.fullName
    ? user.fullName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : 'U';

  const navItems: NavItem[] = NAV_ITEMS.map((item) => {
    if (item.id === 'notifications') return { ...item, badge: notificationCount };
    if (item.id === 'overview') return { ...item, badge: overdueCount > 0 ? overdueCount : undefined };
    return item;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <div className="flex items-center gap-2 px-4 py-5 border-b border-border">
        <div className="w-9 h-9 rounded-lg bg-gradient-hero flex items-center justify-center flex-shrink-0">
          <Shield className="w-5 h-5 text-primary-foreground" />
        </div>
        <span className="text-xl font-bold text-foreground">Smart Ajo</span>
      </div>

      {/* Quick Action */}
      <div className="px-3 py-3">
        <Button
          className="w-full gap-2 justify-start"
          onClick={() => {
            onClose?.();
            navigate('/groups/create');
          }}
        >
          <Plus className="w-4 h-4" />
          New Group
        </Button>
      </div>

      <Separator />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
        {navItems.map((item) => {
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              onClick={() => handleNav(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group ${
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              <span className={isActive ? 'text-primary-foreground' : 'text-muted-foreground group-hover:text-foreground'}>
                {item.icon}
              </span>
              <span className="flex-1 text-left">{item.label}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <Badge
                  variant={isActive ? 'outline' : 'destructive'}
                  className={`text-xs h-5 min-w-[20px] flex items-center justify-center px-1 ${
                    isActive ? 'border-primary-foreground text-primary-foreground' : ''
                  }`}
                >
                  {item.badge > 99 ? '99+' : item.badge}
                </Badge>
              )}
            </button>
          );
        })}

        <Separator className="my-2" />

        {/* Settings shortcut */}
        <button
          onClick={() => {
            onClose?.();
            navigate('/profile/settings');
          }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-150"
        >
          <Settings className="w-5 h-5" />
          <span>Settings</span>
        </button>
      </nav>

      <Separator />

      {/* User profile footer */}
      <div className="px-3 py-4 space-y-3">
        <div className="flex items-center gap-3 px-2">
          <Avatar className="w-9 h-9 flex-shrink-0">
            <AvatarFallback className="bg-primary text-primary-foreground text-sm font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{user?.fullName}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
          </div>
          {user?.isVerified && (
            <Shield className="w-4 h-4 text-green-600 flex-shrink-0" aria-label="Verified" />
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="w-full justify-start gap-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </Button>
      </div>
    </div>
  );
}

export default function DashboardLayout({
  activeSection,
  onSectionChange,
  children,
  notificationCount = 0,
  overdueCount = 0,
}: DashboardLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { logout } = useAuth();
  const navigate = useNavigate();

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const sectionLabel = NAV_ITEMS.find((n) => n.id === activeSection)?.label ?? 'Dashboard';

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 lg:z-40 border-r border-border bg-background/95 backdrop-blur-sm shadow-soft">
        <SidebarContent
          activeSection={activeSection}
          onSectionChange={onSectionChange}
          notificationCount={notificationCount}
          overdueCount={overdueCount}
        />
      </aside>

      {/* Mobile Sidebar (Sheet) */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <button
            className="lg:hidden fixed top-3 left-3 z-50 p-2 rounded-lg bg-background border border-border shadow-md hover:bg-accent transition-colors"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-72 max-w-[80vw]">
          <SidebarContent
            activeSection={activeSection}
            onSectionChange={onSectionChange}
            notificationCount={notificationCount}
            overdueCount={overdueCount}
            onClose={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Main content */}
      <div className="flex-1 flex flex-col lg:ml-64 min-w-0">
        {/* Top bar (mobile + desktop) */}
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-3">
          {/* Left: section title (offset for mobile menu button) */}
          <div className="flex items-center gap-2 ml-10 lg:ml-0">
            <span className="text-foreground/40 text-sm hidden sm:block">Dashboard</span>
            <ChevronRight className="w-4 h-4 text-foreground/30 hidden sm:block" />
            <h2 className="text-sm font-semibold text-foreground">{sectionLabel}</h2>
          </div>

          {/* Right: quick links */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSectionChange('notifications')}
              className="relative gap-1.5"
              aria-label="Notifications"
            >
              <Bell className="w-4 h-4" />
              {notificationCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center">
                  {notificationCount > 9 ? '9+' : notificationCount}
                </span>
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Profile menu"
                >
                  <UserCircle className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => onSectionChange('profile')}>
                  <UserCircle className="w-4 h-4 mr-2" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/profile/settings')}>
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
