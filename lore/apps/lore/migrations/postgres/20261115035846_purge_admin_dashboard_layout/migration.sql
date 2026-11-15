-- #Q3667: the admin dashboard's layout is code now, so its stored parameter is purged.
DELETE FROM "parameters" WHERE "name" = 'admin.dashboard.layout';
