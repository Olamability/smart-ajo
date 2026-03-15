/**
 * ContributionSummaryCard Component
 *
 * Displays a per-group payment summary showing:
 *  - Security deposit paid status
 *  - Contribution amount paid (only counted for paid cycles)
 *  - Service fee paid (only counted for paid cycles)
 *  - Expandable cycle-by-cycle breakdown with status, paid date, and transaction ref
 *  - Total contribution per group
 */

import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Shield,
  CheckCircle,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  DollarSign,
  TrendingUp,
  Hash,
} from 'lucide-react';
import { format } from 'date-fns';
import type { GroupContributionSummary } from '@/api/contributions';

interface ContributionSummaryCardProps {
  summary: GroupContributionSummary;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(amount);

const formatDate = (dateStr?: string) =>
  dateStr ? format(new Date(dateStr), 'MMM dd, yyyy') : '—';

function CycleStatusBadge({ status, isOverdue }: { status: string; isOverdue: boolean }) {
  if (status === 'paid') {
    return (
      <Badge className="bg-green-500 text-white gap-1 text-xs">
        <CheckCircle className="w-3 h-3" />
        Paid
      </Badge>
    );
  }
  if (status === 'overdue' || isOverdue) {
    return (
      <Badge className="bg-red-500 text-white gap-1 text-xs">
        <AlertCircle className="w-3 h-3" />
        Overdue
      </Badge>
    );
  }
  if (status === 'waived') {
    return (
      <Badge variant="outline" className="gap-1 text-xs">
        Waived
      </Badge>
    );
  }
  return (
    <Badge className="bg-yellow-500 text-white gap-1 text-xs">
      <Clock className="w-3 h-3" />
      Pending
    </Badge>
  );
}

export default function ContributionSummaryCard({ summary }: ContributionSummaryCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base truncate">{summary.groupName}</CardTitle>
            <CardDescription className="text-xs">
              {formatCurrency(summary.contributionAmount)} / cycle ·{' '}
              {summary.serviceFeePercentage}% service fee
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-xs shrink-0">
            {summary.totalCyclesPaid} / {summary.cycles.length} paid
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Payment summary row */}
        <div className="grid grid-cols-3 gap-3">
          {/* Security deposit */}
          <div className="flex flex-col gap-1 p-2.5 rounded-lg bg-muted/40">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Shield className="w-3.5 h-3.5" />
              Security Deposit
            </div>
            <p className="text-sm font-semibold">
              {formatCurrency(summary.securityDepositAmount)}
            </p>
            {summary.securityDepositPaid ? (
              <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                <CheckCircle className="w-3 h-3" />
                Paid
                {summary.securityDepositPaidAt && (
                  <span className="text-muted-foreground font-normal">
                    · {formatDate(summary.securityDepositPaidAt)}
                  </span>
                )}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                <Clock className="w-3 h-3" />
                Unpaid
              </span>
            )}
          </div>

          {/* Contributions paid */}
          <div className="flex flex-col gap-1 p-2.5 rounded-lg bg-muted/40">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <DollarSign className="w-3.5 h-3.5" />
              Contributions
            </div>
            <p className="text-sm font-semibold">
              {formatCurrency(summary.totalContributionsPaid)}
            </p>
            <span className="text-xs text-muted-foreground">
              {summary.totalCyclesPaid} cycle{summary.totalCyclesPaid !== 1 ? 's' : ''} paid
            </span>
          </div>

          {/* Service fees paid */}
          <div className="flex flex-col gap-1 p-2.5 rounded-lg bg-muted/40">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <TrendingUp className="w-3.5 h-3.5" />
              Service Fees
            </div>
            <p className="text-sm font-semibold">
              {formatCurrency(summary.totalServiceFeesPaid)}
            </p>
            <span className="text-xs text-muted-foreground">
              {summary.serviceFeePercentage}% per cycle
            </span>
          </div>
        </div>

        {/* Cycle breakdown toggle */}
        {summary.cycles.length > 0 && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="w-full gap-2 h-8 text-xs"
              onClick={() => setExpanded((prev) => !prev)}
            >
              {expanded ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5" />
                  Hide cycle details
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5" />
                  View {summary.cycles.length} cycle{summary.cycles.length !== 1 ? 's' : ''}
                </>
              )}
            </Button>

            {expanded && (
              <div className="space-y-2 pt-1">
                <Separator />
                {summary.cycles.map((cycle) => (
                  <div
                    key={cycle.id}
                    className="flex flex-col gap-1.5 p-3 border rounded-lg bg-background"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">Cycle {cycle.cycleNumber}</p>
                      <CycleStatusBadge status={cycle.status} isOverdue={cycle.isOverdue} />
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <div>
                        <span className="text-muted-foreground">Amount: </span>
                        <span className="font-medium">{formatCurrency(cycle.amount)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Service fee: </span>
                        <span className="font-medium">{formatCurrency(cycle.serviceFee)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Due: </span>
                        <span className="font-medium">{formatDate(cycle.dueDate)}</span>
                      </div>
                      {cycle.paidDate && (
                        <div>
                          <span className="text-muted-foreground">Paid: </span>
                          <span className="font-medium text-green-600">
                            {formatDate(cycle.paidDate)}
                          </span>
                        </div>
                      )}
                    </div>

                    {cycle.transactionRef && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground pt-1.5 border-t mt-1">
                        <Hash className="w-3 h-3 shrink-0" />
                        <span className="truncate font-mono">{cycle.transactionRef}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
