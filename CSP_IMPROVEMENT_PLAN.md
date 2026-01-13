# Content Security Policy - Future Improvements

## Current State

The application currently uses `'unsafe-inline'` and `'unsafe-eval'` in the CSP policy. This is **not ideal** from a security perspective.

## Why These Are Currently Present

1. **'unsafe-inline'**: Required for:
   - React inline styles
   - Vite HMR (Hot Module Replacement) in development
   - Some UI component libraries (e.g., shadcn/ui)
   - Vercel Live preview

2. **'unsafe-eval'**: Required for:
   - Vite's dynamic imports in development mode
   - Some dependencies that use `eval()` or `Function()` constructors

## Security Impact

While these directives weaken CSP protection, the application still has:
- ✅ XSS Protection enabled
- ✅ Frame protection (DENY)
- ✅ Content type sniffing disabled
- ✅ HTTPS enforcement
- ✅ Strict referrer policy

## Recommended Future Improvements

### 1. Remove 'unsafe-inline' for Scripts
**Goal**: Use nonces or hashes for inline scripts

**Implementation**:
```typescript
// In vite.config.ts, add plugin for CSP nonces
import { cspNonce } from 'vite-plugin-csp-nonce';

export default defineConfig({
  plugins: [
    react(),
    cspNonce(),
  ],
});
```

Then update CSP:
```
script-src 'self' 'nonce-{NONCE}' https://js.paystack.co https://vercel.live;
```

### 2. Remove 'unsafe-inline' for Styles
**Options**:
- Use external CSS files only
- Generate style hashes during build
- Use CSS-in-JS solutions with nonce support

### 3. Remove 'unsafe-eval'
**Required Changes**:
- Audit all dependencies for `eval()` usage
- Replace or configure build tools to avoid eval
- Use source maps instead of eval for development

**Vite Configuration**:
```typescript
// vite.config.ts
export default defineConfig({
  build: {
    sourcemap: true, // Instead of eval-source-map
  },
});
```

### 4. Use Report-Only Mode First
Before enforcing stricter CSP, test with report-only:

```typescript
{
  "key": "Content-Security-Policy-Report-Only",
  "value": "default-src 'self'; script-src 'self' https://js.paystack.co; ..."
}
```

Monitor reports to identify violations before enforcing.

## Implementation Plan

### Phase 1: Analysis (1-2 days)
- [ ] Audit all inline scripts and styles
- [ ] Identify dependencies using eval
- [ ] Set up CSP reporting endpoint
- [ ] Enable Report-Only mode

### Phase 2: Inline Scripts (3-5 days)
- [ ] Implement nonce generation
- [ ] Move inline scripts to external files where possible
- [ ] Update Vite configuration
- [ ] Test in development and production

### Phase 3: Styles (2-3 days)
- [ ] Audit CSS-in-JS usage
- [ ] Implement nonce for styles or move to external CSS
- [ ] Update component libraries if needed

### Phase 4: Eval Removal (5-7 days)
- [ ] Update Vite config to avoid eval
- [ ] Replace dependencies that require eval
- [ ] Update build process
- [ ] Comprehensive testing

### Phase 5: Enforcement (1-2 days)
- [ ] Switch from Report-Only to enforcing mode
- [ ] Monitor for violations
- [ ] Fix any remaining issues

## Priority

**Current**: Low - Not blocking payment verification fix
**Long-term**: Medium - Security improvement for production

The current CSP configuration is acceptable for now as:
- The application has other security measures in place
- Many modern SPAs use similar policies
- Removing unsafe-inline/eval requires significant refactoring

## Resources

- [MDN CSP Guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [CSP Evaluator](https://csp-evaluator.withgoogle.com/)
- [Vite CSP Configuration](https://vitejs.dev/guide/build.html#content-security-policy)
- [React CSP Best Practices](https://reactjs.org/docs/faq-security.html#content-security-policy)

## Related Issues

This is a pre-existing configuration, not introduced by the payment verification fix. The only CSP changes in this PR are:
- Added `https://*.paystack.co` (required for Paystack integration)
- Added `https://checkout.paystack.com` (required for Paystack checkout)
- Added `https://*.paystack.com` (required for Paystack resources)

---

**Note**: This document is for future reference. The current fix focuses on payment verification and does not modify the existing unsafe-inline/unsafe-eval configuration.
