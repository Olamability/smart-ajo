import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getUserTransactions } from '../api/transactions';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Download, Loader2, DollarSign, TrendingUp, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { exportTransactionsToPDF } from '../lib/pdfExport';

// Extended transaction type for PDF export
interface ExtendedTransaction {
  id: string;
  type: string;
  amount: number;
  status: string;
  reference: string;
  payment_method: string;
  created_at: string;
  group_id?: string;
  metadata?: any;
}

export default function TransactionsPage() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<ExtendedTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'contribution' | 'payout' | 'security_deposit'>('all');

  useEffect(() => {
    loadTransactions();
  }, []);

  const loadTransactions = async () => {
    setLoading(true);
    try {
      const result = await getUserTransactions();
      if (result.success && result.transactions) {
        // Map to the extended transaction format
        const mappedTransactions: ExtendedTransaction[] = result.transactions.map(tx => ({
          id: tx.id,
          type: tx.type,
          amount: tx.amount,
          status: tx.status,
          reference: tx.reference,
          created_at: tx.date,
          group_id: tx.groupId,
          payment_method: 'paystack',
          metadata: {},
        }));
        setTransactions(mappedTransactions);
      } else {
        toast.error(result.error || 'Failed to load transactions');
      }
    } catch (error) {
      console.error('Error loading transactions:', error);
      toast.error('Failed to load transactions');
    } finally {
      setLoading(false);
    }
  };

  const handleExportPDF = () => {
    if (!user) return;

    const filteredTransactions = filterTransactions();
    
    if (filteredTransactions.length === 0) {
      toast.error('No transactions to export');
      return;
    }

    try {
      exportTransactionsToPDF(
        filteredTransactions,
        user.email || 'User',
        user.email || ''
      );
      toast.success('PDF exported successfully');
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export PDF');
    }
  };

  const filterTransactions = () => {
    if (filter === 'all') return transactions;
    return transactions.filter(tx => tx.type === filter);
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
        return 'default';
      case 'pending':
        return 'secondary';
      case 'failed':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'payout':
        return <TrendingUp className="h-5 w-5 text-green-500" />;
      case 'contribution':
      case 'security_deposit':
        return <DollarSign className="h-5 w-5 text-blue-500" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-500" />;
    }
  };

  const getTransactionLabel = (type: string) => {
    switch (type) {
      case 'contribution':
        return 'Contribution';
      case 'payout':
        return 'Payout';
      case 'security_deposit':
        return 'Security Deposit';
      default:
        return type;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <p className="mt-4 text-muted-foreground">Loading transactions...</p>
        </div>
      </div>
    );
  }

  const filteredTransactions = filterTransactions();

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">Transaction History</h1>
            <p className="text-muted-foreground mt-1">
              View and export your transaction records
            </p>
          </div>
          <Button onClick={handleExportPDF} disabled={filteredTransactions.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Export PDF
          </Button>
        </div>
      </div>

      {/* Filter Buttons */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Button
          variant={filter === 'all' ? 'default' : 'outline'}
          onClick={() => setFilter('all')}
          size="sm"
        >
          All
        </Button>
        <Button
          variant={filter === 'contribution' ? 'default' : 'outline'}
          onClick={() => setFilter('contribution')}
          size="sm"
        >
          Contributions
        </Button>
        <Button
          variant={filter === 'payout' ? 'default' : 'outline'}
          onClick={() => setFilter('payout')}
          size="sm"
        >
          Payouts
        </Button>
        <Button
          variant={filter === 'security_deposit' ? 'default' : 'outline'}
          onClick={() => setFilter('security_deposit')}
          size="sm"
        >
          Security Deposits
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Transactions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{transactions.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Paid
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ₦{transactions
                .filter(tx => ['contribution', 'security_deposit'].includes(tx.type) && tx.status === 'completed')
                .reduce((sum, tx) => sum + tx.amount, 0)
                .toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Received
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ₦{transactions
                .filter(tx => tx.type === 'payout' && tx.status === 'completed')
                .reduce((sum, tx) => sum + tx.amount, 0)
                .toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Transactions List */}
      <Card>
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
          <CardDescription>
            {filteredTransactions.length} transaction{filteredTransactions.length !== 1 ? 's' : ''} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredTransactions.length === 0 ? (
            <div className="text-center py-12">
              <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No transactions found</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredTransactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border rounded-lg gap-4"
                >
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    <div className="flex-shrink-0 mt-1">
                      {getTransactionIcon(transaction.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className="font-medium truncate">
                          {getTransactionLabel(transaction.type)}
                        </p>
                        <Badge variant={getStatusColor(transaction.status)}>
                          {transaction.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Ref: {transaction.reference}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(transaction.created_at), 'MMM dd, yyyy HH:mm')}
                      </p>
                    </div>
                  </div>
                  <div className="text-right sm:text-left">
                    <p className="font-bold text-lg">
                      {transaction.type === 'payout' ? '+' : '-'}₦{transaction.amount.toLocaleString()}
                    </p>
                    {transaction.payment_method && (
                      <p className="text-xs text-muted-foreground capitalize">
                        {transaction.payment_method.replace('_', ' ')}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
