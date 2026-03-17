import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface SkeletonCardProps {
  className?: string;
  lines?: number;
  showHeader?: boolean;
}

export function SkeletonCard({ className, lines = 3, showHeader = true }: SkeletonCardProps) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      {showHeader && (
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3 w-1/2 mt-1" />
        </CardHeader>
      )}
      <CardContent className={showHeader ? '' : 'pt-6'}>
        <div className="space-y-3">
          {Array.from({ length: lines }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-4" style={{ width: `${55 + (i % 3) * 15}%` }} />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface StatsSkeletonCardProps {
  className?: string;
}

export function StatsSkeletonCard({ className }: StatsSkeletonCardProps) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="pt-5">
        <div className="flex items-center justify-between">
          <div className="space-y-2 flex-1">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-16" />
          </div>
          <Skeleton className="w-10 h-10 rounded-full flex-shrink-0" />
        </div>
        <Skeleton className="h-3 w-20 mt-2" />
      </CardContent>
    </Card>
  );
}

export default SkeletonCard;
