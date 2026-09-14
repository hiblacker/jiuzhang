package com.bydw.batch;

import java.util.Optional;

public interface BatchRepository {
  Optional<IngestionBatch> start(long jobId, String runKey, String cursorToJson);
  Optional<IngestionBatch> find(long batchId);
  Optional<IngestionBatch> findByRunKey(long jobId, String runKey);
  boolean complete(long batchId, long jobId, long expectedCheckpointVersion,
      String nextCheckpointJson, long rowCount, String checksum);
  boolean fail(long batchId, String errorCode, String diagnosticRef);
  CheckpointView currentCheckpoint(long jobId);
}
