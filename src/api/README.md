# API Layer

This directory contains the API service layer for the Smart Ajo platform. All functions here interact with Supabase backend services.

## Architecture

This is **NOT** a traditional REST API server or Node.js backend. Instead, this directory contains:
- **Service functions** that call Supabase client directly
- **Type-safe wrappers** around Supabase operations
- **Business logic** for complex operations

All server-side logic (authentication, database operations, storage) is handled by Supabase:
- **Authentication**: Supabase Auth
- **Database**: PostgreSQL with Row Level Security (RLS)
- **Storage**: Supabase Storage
- **Server-side Logic**: Database triggers, PostgreSQL functions, and views
- **Real-time**: Supabase Realtime subscriptions

**Note**: We use Supabase's built-in database features (triggers, functions, RLS policies, views) for all server-side operations. No separate backend server or Edge Functions are needed.

## Structure

```
src/api/
├── index.ts           # Main exports
├── groups.ts          # Group management operations
├── contributions.ts   # Contribution tracking
├── transactions.ts    # Transaction history
└── notifications.ts   # User notifications
```

## Usage

Import API functions directly in your components:

```typescript
import { createGroup, getUserGroups } from '@/api';
// OR
import { createGroup } from '@/api/groups';

// Use in component
const handleCreateGroup = async (data: CreateGroupFormData) => {
  const result = await createGroup(data);
  if (result.success) {
    console.log('Group created:', result.group);
  } else {
    console.error('Error:', result.error);
  }
};
```

## Security

- All database operations are protected by **Row Level Security (RLS)** policies
- Users can only access their own data
- Authentication is enforced at the database level
- All operations use the Supabase **anon key** (browser-safe)
- Sensitive operations requiring elevated permissions should use **Supabase Edge Functions**

## API Functions

### Groups (`groups.ts`)
- `createGroup(data)` - Create a new Ajo group
- `getUserGroups()` - Get all groups for current user
- `getGroupById(groupId)` - Get a specific group
- `joinGroup(groupId)` - Join an existing group

### Contributions (`contributions.ts`)
- `getGroupContributions(groupId)` - Get contributions for a group
- `getUserContributions()` - Get user's contributions across all groups
- `recordContributionPayment(contributionId, transactionRef)` - Record a payment

### Transactions (`transactions.ts`)
- `getUserTransactions()` - Get all transactions for current user
- `getGroupTransactions(groupId)` - Get transactions for a group
- `createTransaction(transaction)` - Create a new transaction record

### Notifications (`notifications.ts`)
- `getUserNotifications()` - Get all notifications for current user
- `getUnreadNotificationsCount()` - Get count of unread notifications
- `markNotificationAsRead(notificationId)` - Mark a notification as read
- `markAllNotificationsAsRead()` - Mark all notifications as read
- `deleteNotification(notificationId)` - Delete a notification

## Best Practices

1. **Error Handling**: All functions return `{ success, data?, error? }` format
2. **Type Safety**: Use TypeScript types from `@/types`
3. **Authentication**: Check user authentication before making calls
4. **Loading States**: Handle loading/error states in components
5. **Caching**: Consider using React Query for data caching

## Example Component

```typescript
import { useState, useEffect } from 'react';
import { getUserGroups } from '@/api';
import { Group } from '@/types';

export function GroupsList() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchGroups = async () => {
      const result = await getUserGroups();
      if (result.success) {
        setGroups(result.groups || []);
      } else {
        setError(result.error || 'Failed to fetch groups');
      }
      setLoading(false);
    };

    fetchGroups();
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      {groups.map(group => (
        <div key={group.id}>{group.name}</div>
      ))}
    </div>
  );
}
```

## Adding New API Functions

When adding new API functions:

1. Create a new file or add to existing file
2. Import necessary types from `@/types`
3. Use `createClient()` from `@/lib/client/supabase`
4. Follow the return pattern: `{ success: boolean; data?: T; error?: string }`
5. Add proper error handling and logging
6. Export from `index.ts` if needed
7. Document the function with JSDoc comments

## Related Documentation

- [Supabase Documentation](https://supabase.com/docs)
- [Row Level Security Guide](../supabase/README.md)
- [Type Definitions](../types/index.ts)
