# P012 manager tests

Not run in this session.

Menu sorting, stock, nutrition, pairings, stations, invitations, cash audit, production, waste, forecasting, and planning were not exercised in the browser or against a disposable database. The training route now rate-limits a manager to 4 requests an hour. That limit was unit-tested only through the shared Redis counter helper, not through the training endpoint.
