const { isEnabled } = require('@librechat/api');

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=(), usb=()');
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  );

  if (req.secure && !isEnabled(process.env.DISABLE_HSTS)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  if (req.path.startsWith('/api/auth/') || req.path.startsWith('/api/admin/auth/')) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
}

module.exports = securityHeaders;
