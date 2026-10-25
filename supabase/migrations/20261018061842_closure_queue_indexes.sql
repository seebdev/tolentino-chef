-- Cover foreign keys used when deleting only isolated QA accounts/jobs.
-- Advisory review 2026-10-18: no row changes and no change to authorization.
create index import_attempts_actor_idx on private.import_attempts(actor_user_id);
create index translation_attempts_job_idx on private.translation_attempts(job_id);