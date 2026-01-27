# Payment Button Visibility - Visual Reference

## Quick Reference: Where Are the Payment Buttons?

```
┌─────────────────────────────────────────────────────────────────┐
│                    GROUP DETAIL PAGE                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [Back] 🛡️ Group Name                    [forming] [Creator]   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  SCENARIO 1: CREATOR NEEDS TO PAY                              │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ ⚠️  Complete Your Group Setup                            │ │
│  │                                                           │ │
│  │ As the group creator, select your payout position        │ │
│  │ and complete your payment to activate the group.         │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Select Your Payout Position                               │ │
│  │                                                           │ │
│  │ [1] [2] [3] [4] [5] [6]  ← Click a slot                  │ │
│  │                                                           │ │
│  │ ✅ Position #3 Selected                                   │ │
│  │ You will receive your payout during cycle 3              │ │
│  │                                                           │ │
│  │ Payment Breakdown:                                        │ │
│  │ Security Deposit: ₦10,000                                │ │
│  │ First Contribution: ₦50,000                              │ │
│  │ Total Amount: ₦60,000                                    │ │
│  │                                                           │ │
│  │ ┌─────────────────────────────────────────────────────┐  │ │
│  │ │  💳 Pay ₦60,000 to Activate Group                  │  │ │
│  │ └─────────────────────────────────────────────────────┘  │ │
│  │         ↑ PAYMENT BUTTON #1 (Creator)                    │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  SCENARIO 2: APPROVED MEMBER NEEDS TO PAY                      │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ ✅ Your request has been approved!                       │ │
│  │                                                           │ │
│  │ Complete your payment to activate your membership        │ │
│  │                                                           │ │
│  │ Your Payout Position: [#3]                               │ │
│  │ You will receive your payout during cycle 3              │ │
│  │                                                           │ │
│  │ Payment Breakdown:                                        │ │
│  │ Security Deposit: ₦10,000                                │ │
│  │ First Contribution: ₦50,000                              │ │
│  │ Total Amount: ₦60,000                                    │ │
│  │                                                           │ │
│  │ ┌─────────────────────────────────────────────────────┐  │ │
│  │ │  💳 Pay ₦60,000 to Join                            │  │ │
│  │ └─────────────────────────────────────────────────────┘  │ │
│  │         ↑ PAYMENT BUTTON #2 (Approved Member)            │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  [Overview] [Members] [Activity]                               │
│                                                                 │
│  ... Group details and tabs content ...                        │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Security Deposit                                          │ │
│  │                                                           │ │
│  │ ⚠️ You need to pay your security deposit to participate  │ │
│  │                                                           │ │
│  │ ┌─────────────────────────────────────────────────────┐  │ │
│  │ │  🛡️ Pay Security Deposit (₦10,000)                 │  │ │
│  │ └─────────────────────────────────────────────────────┘  │ │
│  │         ↑ PAYMENT BUTTON #3 (Fallback)                   │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Decision Tree: Which Button Will You See?

```
                    START: View Group Detail Page
                                  |
                                  v
                    ┌─────────────────────────┐
                    │ Are you the creator?    │
                    └─────────────────────────┘
                          /              \
                       YES               NO
                        |                 |
                        v                 v
              ┌──────────────────┐   ┌──────────────────┐
              │ Have you paid?   │   │ Are you a member?│
              └──────────────────┘   └──────────────────┘
                 /           \            /           \
              YES            NO         YES            NO
               |             |           |             |
               v             v           v             v
        ┌──────────┐  ┌───────────┐  ┌─────────┐  ┌─────────────┐
        │No button │  │SELECT SLOT│  │Have you │  │ Have join   │
        │(already  │  │    ↓      │  │  paid?  │  │  request?   │
        │ active)  │  │BUTTON #1  │  └─────────┘  └─────────────┘
        └──────────┘  │(Activate  │    /      \        /      \
                      │  Group)   │  YES     NO      YES       NO
                      └───────────┘   |      |        |        |
                                      v      v        v        v
                                 ┌────┐ ┌────┐  ┌─────┐  ┌─────┐
                                 │No  │ │Pay │  │Status│  │Join │
                                 │btn │ │Sec │  │ of   │  │btn │
                                 │    │ │Dep │  │request│  │    │
                                 └────┘ │#3  │  └─────┘  └─────┘
                                        └────┘     |
                                                Pending → No button
                                                   |
                                                Approved
                                                   ↓
                                              ┌─────────┐
                                              │BUTTON #2│
                                              │(Join Grp)│
                                              └─────────┘
```

## Common Scenarios Explained

### Scenario A: "I just created a group"
**What you should see:**
1. Orange alert: "Complete Your Group Setup"
2. Slot selection grid
3. After selecting a slot → Blue confirmation box
4. Payment breakdown
5. **BUTTON #1**: "Pay ₦X,XXX to Activate Group"

**If you don't see the button:**
- Did you select a slot? Button only appears AFTER slot selection
- Check browser console (F12) for errors

### Scenario B: "I requested to join and admin approved"
**What you should see:**
1. Green alert: "✅ Your request has been approved!"
2. Your assigned position in a badge
3. Payment breakdown
4. **BUTTON #2**: "Pay ₦X,XXX to Join"

**If you don't see the button:**
- Refresh the page (F5)
- Verify the green alert is visible
- Check that group status is still "forming"

### Scenario C: "I'm a member but haven't paid"
**What you should see:**
1. In the "Overview" tab, scroll to "Security Deposit" card
2. Warning message about payment needed
3. **BUTTON #3**: "Pay Security Deposit (₦X,XXX)"

### Scenario D: "I want to join a group"
**What you should see:**
1. Blue alert: "This group is accepting new members"
2. "Join Group" button (this is NOT a payment button)
3. Click to open join dialog → Select slot → Send request
4. Wait for admin approval
5. After approval → You'll see **BUTTON #2**

## Button States

### Active (Clickable)
```
┌─────────────────────────────────────┐
│  💳 Pay ₦60,000 to Activate Group  │  ← Green/Blue
└─────────────────────────────────────┘
```

### Processing (Disabled)
```
┌─────────────────────────────────────┐
│  ⏳ Processing Payment...           │  ← Gray
└─────────────────────────────────────┘
```

### Hidden (Not Visible)
- No button at all
- Check conditions above for why

## Where Buttons Are Located in Code

For developers and debugging:

```typescript
// BUTTON #1: Creator Payment (Line ~542)
shouldShowCreatorPaymentPrompt() && selectedSlot
  └─> "Pay {amount} to Activate Group"

// BUTTON #2: Approved Member Payment (Line ~601)
currentUserMember && !securityDepositPaid && !isCreator
  └─> "Pay {amount} to Join"

// BUTTON #3: Security Deposit Fallback (Line ~878)
currentUserMember && !securityDepositPaid
  └─> "Pay Security Deposit ({amount})"
```

## Quick Troubleshooting

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| No button at all | Check your role and status | See decision tree above |
| Button is gray | Payment in progress | Wait, don't refresh |
| Button disappeared after refresh | Already paid | Check member list |
| See "Join" but not "Pay" | Request not approved yet | Wait for admin |
| Selected slot but no button | Page not updated | Refresh browser |

## Still Need Help?

1. Take screenshot of entire page
2. Note your role (creator/member/visitor)
3. Note group status (forming/active/etc)
4. Check browser console (F12 → Console tab)
5. Share details with support
