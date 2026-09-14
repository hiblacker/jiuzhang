package com.bydw.source;

import java.util.List;

public record SourcePage(List<SourceConnection> items, int limit, int offset, int count) {}
