package cn.jiuzhang.platform.overview.application;

import java.util.Map;

public interface OverviewStore {
    Map<String, Object> snapshot(boolean includeAudit);
}
