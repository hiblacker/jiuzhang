-- Forward-only metadata guard, installed together with V001 in fresh experiment databases.
CREATE FUNCTION warehouse.guard_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'release deletion forbidden'; END IF;
 IF (NEW.release_id,NEW.input_cutoff,NEW.rule_version,NEW.finalized,NEW.created_at)
  IS DISTINCT FROM (OLD.release_id,OLD.input_cutoff,OLD.rule_version,OLD.finalized,OLD.created_at) THEN
  RAISE EXCEPTION 'release manifest immutable';
 END IF;
 IF NOT ((OLD.state='BUILDING' AND NEW.state='READY') OR (OLD.state='READY' AND NEW.state='PUBLISHED')) THEN
  RAISE EXCEPTION 'invalid release transition';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER release_guard BEFORE UPDATE OR DELETE ON warehouse.release
 FOR EACH ROW EXECUTE FUNCTION warehouse.guard_release();
REVOKE ALL ON FUNCTION warehouse.guard_release() FROM PUBLIC;
