package com.bydw.batch;

import java.util.List;

public record BatchReconcileResult(int reconciledCount, List<Long> batchIds) {}
