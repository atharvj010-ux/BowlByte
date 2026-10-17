# P012 kitchen tests

Not run in this session.

The source snapshot has no kitchen staff account. Kitchen authorization, accept, reject, station queue, FIFO, capacity, task start, completion, ETA, and READY were not exercised against PostgreSQL. Existing `test_kitchen_integration.py` is marked integration and was deselected. It was not run, because the host database name is the live `bowlbyte` database rather than `bowlbyte_test`.
