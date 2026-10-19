package cn.jiuzhang.platform;

import cn.jiuzhang.platform.execution.domain.SnapshotPolicy;
import cn.jiuzhang.platform.execution.domain.SnapshotPolicy.SourceColumn;
import cn.jiuzhang.platform.execution.domain.SnapshotPolicy.HistoricalSnapshot;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.time.Duration;
import java.util.List;
import java.util.Set;
import static org.assertj.core.api.Assertions.*;

class SnapshotPolicyTest {
    @Test void emptyFirstLoadAndExplicitOverrideDifferFromAccidentalErasure() {
        assertThat(SnapshotPolicy.requiresEmptyApproval(0, 0, false)).isFalse();
        assertThat(SnapshotPolicy.requiresEmptyApproval(100000, 0, false)).isTrue();
        assertThat(SnapshotPolicy.requiresEmptyApproval(100000, 0, true)).isFalse();
        assertThat(SnapshotPolicy.requiresEmptyApproval(100000, 1, false)).isFalse();
    }
    @Test void unusedAdditionsAndOrderingAreCompatibleButUsedTypeAndMissingFieldsAreNot() {
        var id = new SourceColumn("id", "bigint", 19, 0, 0, false);
        var amount = new SourceColumn("amount", "decimal", 20, 4, 0, false);
        var extra = new SourceColumn("extra", "varchar", 0, 0, 128, true);
        assertThat(SnapshotPolicy.changedUsedColumns(List.of(id, amount), List.of(extra, amount, id), Set.of("id", "amount"))).isEmpty();
        assertThat(SnapshotPolicy.changedUsedColumns(List.of(id, amount), List.of(id, new SourceColumn("amount", "decimal", 20, 2, 0, false)), Set.of("amount"))).containsExactly("amount");
        assertThat(SnapshotPolicy.changedUsedColumns(List.of(id, amount), List.of(id), Set.of("amount"))).containsExactly("amount");
    }
    @Test void historyHasIndependentCountAndAgeLimits() {
        var now = Instant.parse("2026-10-19T00:00:00Z");
        var history = List.of(new HistoricalSnapshot("a", now), new HistoricalSnapshot("b", now.minusSeconds(1)),
            new HistoricalSnapshot("c", now.minusSeconds(2)), new HistoricalSnapshot("d", now.minusSeconds(3)),
            new HistoricalSnapshot("e", now.minus(Duration.ofDays(7))));
        assertThat(SnapshotPolicy.expiredHistory(history, now)).containsExactly("d", "e");
        assertThat(SnapshotPolicy.expiredHistory(List.of(history.get(4)), now)).containsExactly("e");
    }
}
