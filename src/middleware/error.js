export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  if (status >= 500 && (!err.code || err.code === 'server_error')) console.error(err);
  const hide = status >= 500 && (!err.code || err.code === 'server_error');
  return res.status(status).json({
    error: {
      code: err.code || 'server_error',
      message: hide ? 'Something went wrong.' : err.message,
      memberships: err.memberships,
      leadId: err.leadId,
    },
  });
}
