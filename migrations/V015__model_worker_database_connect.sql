-- The existing database bootstrap revokes PUBLIC CONNECT. Grant only the
-- model execution role access to this database; schema/table grants stay scoped.
DO $$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO bydw_model_builder', current_database());
END $$;
