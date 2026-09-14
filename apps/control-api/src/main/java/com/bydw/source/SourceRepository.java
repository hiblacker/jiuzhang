package com.bydw.source;

import java.util.List;
import java.util.Optional;

public interface SourceRepository {
  SourceConnection create(
      String code, String sourceType, String configJson, String credentialRef);
  List<SourceConnection> list(int limit, int offset);
  Optional<SourceConnection> findById(long id);
  void audit(String principal, String action, String resource, String detailsJson);
}
