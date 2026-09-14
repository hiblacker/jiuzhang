package com.bydw.batch;

import java.time.OffsetDateTime;

public record RawBatchEvidence(
    long rowCount,
    String checksum,
    String writerPrincipal,
    OffsetDateTime sealedAt) {}
