export const requireSU = (req, res, next) => {
  if (req.user?.role !== 'su') {
    return res.status(403).json({ error: 'Superuser access required' });
  }
  next();
};
