package com.bydw.lake;

public record LakeManifestResponse(long systemRunId, String sourceCode, String runKey, String state,
    int objectCount, long rowCount) {}
