package cn.jiuzhang.platform.overview.application;

import cn.jiuzhang.platform.execution.application.RunService;
import cn.jiuzhang.platform.identity.application.IdentityService;
import cn.jiuzhang.platform.identity.application.IdentityService.User;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OverviewService {
    private final OverviewStore store;
    private final RunService runs;

    public OverviewService(OverviewStore store, RunService runs) {
        this.store = store;
        this.runs = runs;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    @SuppressWarnings("unchecked")
    public Map<String, Object> get(User user) {
        IdentityService.require(user, "read");
        var result = store.snapshot(user.permissions().contains("system"));
        for (String key : List.of("recentRuns", "recentFailures")) {
            var ids = (List<String>) result.get(key);
            result.put(key, ids.stream().map(id -> runs.get(user, id)).toList());
        }
        return result;
    }
}
