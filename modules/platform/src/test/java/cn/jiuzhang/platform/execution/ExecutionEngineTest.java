package cn.jiuzhang.platform.execution;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import cn.jiuzhang.platform.dataset.application.*;
import cn.jiuzhang.platform.dataset.domain.DatasetPlan;
import cn.jiuzhang.platform.execution.application.*;
import cn.jiuzhang.platform.identity.application.IdentityService;
import cn.jiuzhang.platform.shared.infrastructure.MetadataJson;
import cn.jiuzhang.platform.source.application.SourceService;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.*;
import java.util.function.Consumer;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;

class ExecutionEngineTest {
  private final RunStore runs = mock(RunStore.class);
  private final DatasetStore datasets = mock(DatasetStore.class);
  private final DatasetService service = mock(DatasetService.class);
  private final SourceService sources = mock(SourceService.class);
  private final WarehousePort warehouse = mock(WarehousePort.class);
  private final ObjectPort objects = mock(ObjectPort.class);
  private final IdentityService identity = mock(IdentityService.class);
  private final ExecutionEngine engine = new ExecutionEngine(runs, datasets, service, sources,
      warehouse, objects, identity, new MetadataJson(new ObjectMapper()));
  private final String token = "00000000-0000-0000-0000-000000000001";
  private final String physical = "jz_s_77_000000000000";

  @SuppressWarnings("unchecked")
  private void prepare(String mode, int rows) {
    var field = new DatasetPlan.Field("id", "id", "integer", false, true, "");
    var plan = new DatasetPlan(List.of(field), List.of(), false, List.of(), List.of());
    var definition = Map.of("mode", "sql", "sourceId", "1", "sql", "SELECT id FROM orders",
        "output", Map.of("table", "result", "writeMode", mode),
        "fields", List.of(Map.of("target", "id", "type", "integer", "nullable", false, "output", true)));
    var version = Map.<String,Object>of("definition", definition);
    var run = Map.<String,Object>of("id", "77", "datasetId", "7", "leaseToken", token,
        "datasetVersion", 1, "status", "running", "scheduleSnapshot", Map.of("timeoutSeconds", 30),
        "allowEmpty", false, "leaseUntil", Instant.now().plusSeconds(60).toString(), "requestedBy", "1");
    when(runs.claim()).thenReturn(run);
    when(runs.heartbeat("77", token)).thenReturn(true);
    when(runs.get(eq("77"), anyBoolean())).thenReturn(run);
    when(runs.transaction(any())).thenAnswer(call -> ((Supplier<?>)call.getArgument(0)).get());
    when(datasets.version("7", 1)).thenReturn(version);
    when(service.executable(version)).thenReturn(plan);
    when(runs.current("7")).thenReturn(Map.of("physical", "previous", "rowCount", "3",
        "fields", definition.get("fields")));
    doAnswer(call -> {
      Consumer<Map<String,Object>> accept = call.getArgument(5);
      for (int i = 0; i < rows; i++) accept.accept(Map.of("id", Integer.toString(i)));
      return null;
    }).when(sources).scanSql(anyString(), anyString(), anyList(), anyList(), anyLong(), any(), any());
    when(warehouse.count(physical)).thenReturn((long)rows, rows + 3L);
    when(warehouse.pointsTo("result", physical)).thenReturn(false, true);
  }

  @Test void appendCopiesPublishedValuesAndStagesTotalWhileKeepingThisRunsCountSeparate() {
    prepare("append", 2);
    engine.next();
    verify(warehouse).copy(eq("previous"), eq(physical), anyList());
    verify(runs).transition(eq("77"), eq(token), eq("validating"), eq(2L), anyList());
    verify(runs).stage(eq("77"), eq(token), eq(physical), anyList(), eq(5L), anyString());
    verify(runs).commit("77", token);
  }

  @Test void emptyAppendPreservesAllPreviousRowsWithoutRequestingEmptyReplacementApproval() {
    prepare("append", 0);
    engine.next();
    verify(runs).stage(eq("77"), eq(token), eq(physical), anyList(), eq(3L), anyString());
    verify(runs).commit("77", token);
  }

  @Test void fullReplacementDoesNotCopyOldRows() {
    prepare("replace", 2);
    engine.next();
    verify(warehouse, never()).copy(anyString(), anyString(), anyList());
    verify(runs).stage(eq("77"), eq(token), eq(physical), anyList(), eq(2L), anyString());
  }

  @Test void incompatibleAppendNeverCopiesOrPublishesAndLeavesTheCurrentSnapshotAvailable() {
    prepare("append", 1);
    when(runs.current("7")).thenReturn(Map.of("physical", "previous", "rowCount", "3",
        "fields", List.of(Map.of("target", "different", "type", "integer", "nullable", false))));
    engine.next();
    verify(warehouse, never()).copy(anyString(), anyString(), anyList());
    verify(warehouse, never()).publish(anyString(), anyString(), anyList());
    verify(runs).finish("77", token, "blocked", "APPEND_SCHEMA_MISMATCH");
  }

  @Test void publishingRecoveryOnlyReconcilesTheStagedSnapshotWithoutAppendingAgain() {
    prepare("append", 2);
    var run = new LinkedHashMap<>(runs.claim());
    run.put("status", "publishing");
    when(runs.claim()).thenReturn(run);
    when(runs.snapshot("77")).thenReturn(Map.of("physical", physical));
    when(warehouse.pointsTo("result", physical)).thenReturn(true);
    engine.next();
    verifyNoInteractions(sources);
    verify(warehouse, never()).copy(anyString(), anyString(), anyList());
    verify(warehouse, never()).publish(anyString(), anyString(), anyList());
    verify(runs).commit("77", token);
  }
}
