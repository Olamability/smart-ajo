# Content Security Policy (CSP) Configuration

## Overview

This document explains the Content Security Policy (CSP) configuration in `vercel.json` and the security trade-offs made for third-party integrations.

## Current CSP Configuration

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.paystack.co https://vercel.live;
script-src-elem 'self' 'unsafe-inline' https://js.paystack.co https://vercel.live;
style-src 'self' 'unsafe-inline' https://paystack.com https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: https: blob:;
connect-src 'self' https://*.supabase.co https://api.paystack.co wss://*.supabase.co https://vercel.live;
frame-src 'self' https://checkout.paystack.com;
object-src 'none';
base-uri 'self';
form-action 'self'
```

## Security Directives Explained

### ✅ Strict Directives (No Compromises)

1. **`default-src 'self'`** - Default to only loading resources from same origin
2. **`object-src 'none'`** - Block Flash, Java, and other plugins
3. **`base-uri 'self'`** - Prevent base tag injection attacks
4. **`form-action 'self'`** - Forms can only submit to same origin
5. **`frame-src`** - Only allow Paystack checkout iframe

### ⚠️ Relaxed Directives (Required for Third-Party Integration)

#### `script-src 'unsafe-inline' 'unsafe-eval'`

**Why we need these:**

1. **'unsafe-inline'**: Required for:
   - Vite's Hot Module Replacement (HMR) during development
   - React's inline event handlers
   - Paystack's inline initialization scripts

2. **'unsafe-eval'**: Required for:
   - Vite's dynamic imports and code splitting
   - Some React libraries that use dynamic code evaluation

**Security Implications:**

- ❌ **Risk**: Makes app vulnerable to XSS attacks if user input isn't properly sanitized
- ✅ **Mitigation**: All user input is sanitized using `DOMPurify` and React's built-in XSS protection

**Alternative Approaches (for future improvement):**

1. **Use nonces for inline scripts**: Generate a unique nonce per request
   ```html
   <script nonce="random-nonce-123">...</script>
   ```
   CSP: `script-src 'nonce-random-nonce-123'`

2. **Move inline scripts to external files**: Eliminate inline scripts entirely
   - Cons: Requires refactoring Vite build configuration and React patterns

3. **Use strict-dynamic**: Modern CSP approach that trusts scripts loaded by trusted scripts
   - Cons: Not supported by older browsers

#### `style-src 'unsafe-inline'`

**Why we need this:**

1. React's styled components and CSS-in-JS
2. Vite's style injection during development
3. Tailwind CSS utility classes generated at runtime
4. Paystack's button styles loaded from https://paystack.com

**Security Implications:**

- ❌ **Risk**: Attacker could inject malicious styles
- ✅ **Mitigation**: Style injection attacks are less severe than script injection

**Alternative Approaches:**

1. **Use style nonces**: Similar to script nonces
2. **Use hashes**: Generate SHA-256 hashes for each inline style
   - Cons: Requires build-time hash generation and maintenance

## Third-Party Domains Allowed

### Paystack (Payment Gateway)

**Scripts:**
- `https://js.paystack.co` - Paystack Inline JS library

**Styles:**
- `https://paystack.com` - Paystack button CSS and styles

**API:**
- `https://api.paystack.co` - Paystack API for payment operations

**Frames:**
- `https://checkout.paystack.com` - Paystack payment modal iframe

**Why trusted:** Official Paystack domains, required for PCI DSS compliant payment processing

**Note on Fingerprinting:** Fingerprinting and fraud detection scripts from Paystack subdomains (e.g., `standard.paystack.co`) have been disabled by removing the wildcard `https://*.paystack.co` from the CSP. This prevents CSP warnings about query parameters in script paths and removes unnecessary fraud detection overhead. The core payment functionality through `js.paystack.co` and `checkout.paystack.com` remains fully functional.

### Supabase (Backend)

**Connections:**
- `https://*.supabase.co` - Supabase API endpoints
- `wss://*.supabase.co` - Supabase realtime WebSocket connections

**Why trusted:** Official Supabase infrastructure, required for authentication and database access

### Google Fonts

**Styles:**
- `https://fonts.googleapis.com` - Google Fonts CSS

**Fonts:**
- `https://fonts.gstatic.com` - Google Fonts font files

**Why trusted:** Google's official font CDN, widely used and trusted

### Vercel (Deployment Platform)

**Scripts & Connections:**
- `https://vercel.live` - Vercel live preview and analytics

**Why trusted:** Official Vercel infrastructure for deployment platform features

## Images and Media

```
img-src 'self' data: https: blob:
```

**Why relaxed:**
- `data:` - Allow base64 encoded images (user avatars, charts)
- `https:` - Allow any HTTPS image (user profile pictures from external sources)
- `blob:` - Allow blob URLs (generated images, canvas exports)

**Security Implications:**
- ❌ **Risk**: Could load images from any HTTPS domain
- ✅ **Mitigation**: Images cannot execute code, only display content

**Alternative Approaches:**
1. Restrict to specific image CDN domains
2. Proxy all external images through backend
   - Cons: Increased server load and complexity

## Connections (API Calls)

```
connect-src 'self' https://*.supabase.co https://api.paystack.co wss://*.supabase.co https://vercel.live
```

**Allowed connections:**
- Same origin (own API if any)
- Supabase (authentication, database, storage)
- Paystack API (payment verification)
- Vercel (analytics and monitoring)

**Why strict:** Only explicitly trusted domains can be contacted via fetch/XHR/WebSocket

## Security Best Practices Applied

### Input Sanitization

All user-generated content is sanitized:

```typescript
import DOMPurify from 'dompurify';

// Sanitize HTML content
const clean = DOMPurify.sanitize(userInput);
```

### React XSS Protection

React automatically escapes values in JSX:

```tsx
// Safe - React escapes the value
<div>{userInput}</div>

// Unsafe - dangerouslySetInnerHTML bypasses React's protection
// Only used with DOMPurify sanitization
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
```

### HTTP Security Headers

Additional security headers configured:

- **X-Content-Type-Options: nosniff** - Prevent MIME type sniffing
- **X-Frame-Options: DENY** - Block clickjacking (our own frames allowed via CSP)
- **X-XSS-Protection: 1; mode=block** - Enable browser XSS filter
- **Referrer-Policy: strict-origin-when-cross-origin** - Control referrer information

## Future Improvements

### Short Term (1-3 months)

1. **Remove 'unsafe-eval'**: Refactor Vite configuration to avoid dynamic code evaluation
   - Investigate build.target and build.minify options
   - Test with all dynamic imports

2. **Implement nonce-based CSP**: Generate unique nonces for inline scripts
   - Requires server-side rendering or edge function to inject nonces
   - Update Vite configuration to include nonce in script tags

### Medium Term (3-6 months)

1. **Implement CSP reporting**: Monitor violations in production
   ```
   Content-Security-Policy-Report-Only: ...; report-uri /api/csp-report
   ```

2. **Use strict-dynamic**: Modern CSP approach for script whitelisting
   - Verify browser support coverage
   - Test with all third-party scripts

3. **Restrict image sources**: Whitelist specific image CDNs
   - Use Supabase Storage for user uploads
   - Proxy external images through backend

### Long Term (6-12 months)

1. **Remove 'unsafe-inline' for scripts**: Eliminate all inline scripts
   - Refactor to external event handlers
   - Use React refs instead of inline handlers

2. **Implement Subresource Integrity (SRI)**: Verify third-party script integrity
   ```html
   <script src="https://js.paystack.co/v1/inline.js" 
           integrity="sha384-hash" 
           crossorigin="anonymous"></script>
   ```

3. **Regular CSP audits**: Quarterly review and tightening of CSP rules

## Monitoring and Compliance

### CSP Violation Monitoring

Consider implementing CSP reporting:

```typescript
// Add to Express/Edge Function
app.post('/api/csp-report', (req, res) => {
  console.error('CSP Violation:', req.body);
  // Log to monitoring service (Sentry, DataDog, etc.)
  res.status(204).end();
});
```

### Browser Compatibility

Current CSP is compatible with:
- ✅ Chrome 40+
- ✅ Firefox 31+
- ✅ Safari 10+
- ✅ Edge 15+

Coverage: >95% of global browser usage

## Testing CSP

### Test in Development

```bash
# Test CSP violations locally
npm run dev
# Open browser console and check for CSP violations
```

### Test in Production

```bash
# Check CSP headers are set
curl -I https://smart-ajo.vercel.app

# Verify CSP header is present
# Look for: content-security-policy: default-src 'self'; ...
```

### CSP Testing Tools

1. **Browser DevTools**: Check Console for CSP violations
2. **CSP Evaluator**: https://csp-evaluator.withgoogle.com/
3. **Report URI**: https://report-uri.com/home/analyse

## References

- [MDN: Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [CSP Best Practices](https://web.dev/strict-csp/)
- [OWASP: Content Security Policy](https://owasp.org/www-community/controls/Content_Security_Policy)
- [Google CSP Guide](https://developers.google.com/web/fundamentals/security/csp)

---

**Last Updated:** January 12, 2026  
**Security Review Due:** April 12, 2026  
**Next CSP Audit:** March 12, 2026
