package com.bydw.worker;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.OffsetDateTime;

record FixtureRecord(
    JsonNode sourceRecordKey,
    JsonNode payload,
    OffsetDateTime sourceUpdatedAt,
    OffsetDateTime eventTime) {}
