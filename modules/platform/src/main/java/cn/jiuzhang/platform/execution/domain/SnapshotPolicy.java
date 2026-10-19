package cn.jiuzhang.platform.execution.domain;

import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/** Published source contracts and retention are independent of any warehouse engine. */
public final class SnapshotPolicy {
    public record SourceColumn(String name, String type, long precision, int scale,
                               long length, boolean nullable) {}
    public record HistoricalSnapshot(String id, Instant replacedAt) {}

    private SnapshotPolicy() {}

    public static boolean requiresEmptyApproval(long previousRows, long nextRows, boolean allowed) {
        if (previousRows < 0 || nextRows < 0) throw new IllegalArgumentException("Negative row count");
        return previousRows > 0 && nextRows == 0 && !allowed;
    }

    public static Set<String> changedUsedColumns(List<SourceColumn> published,
                                                  List<SourceColumn> current, Set<String> used) {
        Map<String, SourceColumn> expected = published.stream().collect(Collectors.toMap(SourceColumn::name, c -> c));
        Map<String, SourceColumn> actual = current.stream().collect(Collectors.toMap(SourceColumn::name, c -> c));
        return used.stream().filter(name -> !expected.containsKey(name) ||
            !expected.get(name).equals(actual.get(name))).collect(Collectors.toUnmodifiableSet());
    }

    /** Current snapshot is deliberately not an input and can never be selected for cleanup. */
    public static List<String> expiredHistory(List<HistoricalSnapshot> history, Instant now) {
        var ordered = history.stream().sorted(Comparator.comparing(HistoricalSnapshot::replacedAt).reversed()
            .thenComparing(HistoricalSnapshot::id)).toList();
        return java.util.stream.IntStream.range(0, ordered.size())
            .filter(i -> i >= 3 || !ordered.get(i).replacedAt().plus(Duration.ofDays(7)).isAfter(now))
            .mapToObj(i -> ordered.get(i).id()).toList();
    }
}
