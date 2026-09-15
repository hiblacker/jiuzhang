package com.bydw.lake;

public record LakeInventoryResponse(long inventoryId, String sourceCode, long planVersion, int objectCount) {}
