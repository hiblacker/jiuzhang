SELECT * FROM raw_landing.story_batch
WHERE batch_id = (SELECT max(batch_id) FROM raw_landing.story_batch)
