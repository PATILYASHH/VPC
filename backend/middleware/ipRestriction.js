function ipRestriction(req, res, next) {
  if (process.env.ENABLE_IP_RESTRICTION !== 'true') {
    return next();
  }

  const allowedIps = req.admin?.allowed_ips || [];
  if (allowedIps.length === 0) {
    return next();
  }

  const clientIp = req.ip;
  if (!allowedIps.includes(clientIp)) {
    return res.status(403).json({ error: 'Access denied from this IP address' });
  }

  next();
}

module.exports = ipRestriction;
