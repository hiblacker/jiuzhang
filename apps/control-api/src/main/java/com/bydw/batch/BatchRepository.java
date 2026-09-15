package com.bydw.batch;

import java.util.List;
import java.util.Optional;

public interface BatchRepository {
  Optional<IngestionBatch> start(
      long jobId, String runKey, String cursorToJson, String leaseOwner, int leaseSeconds);
  Optional<IngestionBatch> find(long batchId);
  Optional<IngestionBatch> findLatestByRunKey(long jobId, String runKey);
  Optional<RawBatchEvidence> rawEvidence(long batchId);
  Optional<IngestionBatch> retry(long batchId, String leaseOwner, int leaseSeconds);
  Optional<IngestionBatch> heartbeat(long batchId, String leaseOwner, int leaseSeconds);
  BatchCompletionResult complete(long batchId, long jobId, long expectedCheckpointVersion,
      String nextCheckpointJson, long rowCount, String checksum, String leaseOwner);
  boolean fail(long batchId, String errorCode, String diagnosticRef, String leaseOwner);
  boolean cancel(long batchId, String leaseOwner);
  List<Long> reconcileExpired(int limit);
  CheckpointView currentCheckpoint(long jobId);
}
