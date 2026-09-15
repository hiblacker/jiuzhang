package com.bydw.ingestion;

import java.util.List;
import java.util.Optional;

public interface IngestionJobRepository {
  IngestionJob create(long sourceId, String objectName, String strategy,
      String cursorSpecJson, String deleteSpecJson);
  List<IngestionJob> list(int limit, int offset);
  Optional<IngestionJob> findById(long id);
  Optional<IngestionJob> activate(long id);
}
