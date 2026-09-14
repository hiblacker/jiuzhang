package com.bydw.ingestion;

import java.util.List;

public record IngestionJobPage(List<IngestionJob> items, int limit, int offset, int count) {}
