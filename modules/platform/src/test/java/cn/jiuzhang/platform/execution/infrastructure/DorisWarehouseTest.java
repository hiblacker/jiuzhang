package cn.jiuzhang.platform.execution.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

import cn.jiuzhang.platform.execution.application.WarehousePort;
import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.shared.infrastructure.MetadataJson;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class DorisWarehouseTest {
  private final DorisWarehouse warehouse = new DorisWarehouse(new MetadataJson(new ObjectMapper()));

  @Test
  void stopsReadingAsSoonAsTheResultExceedsTheBudget() throws Exception {
    ResultSet result = mock(ResultSet.class);
    AtomicInteger read = new AtomicInteger();
    when(result.next()).thenAnswer(call -> read.incrementAndGet() <= 1000);
    when(result.getString(1)).thenReturn("x".repeat(65533));

    assertThatThrownBy(() -> warehouse.readRows(result, List.of("payload")))
        .isInstanceOfSatisfying(
            Failure.class,
            error -> {
              assertThat(error.status).isEqualTo(422);
              assertThat(error.code).isEqualTo("QUERY_RESULT_LIMIT");
            });
    assertThat(read.get()).isBetween(150, 170);
    verify(result, times(read.get())).getString(1);
  }

  @Test
  void countsJsonEscapingAndArrayDelimitersAtTheExactBoundary() throws Exception {
    // The one-field JSON object and surrounding array consume sixteen bytes.
    ResultSet exact = mock(ResultSet.class);
    when(exact.next()).thenReturn(true, false);
    when(exact.getString(1)).thenReturn("x".repeat(WarehousePort.MAX_RESULT_BYTES - 16));
    assertThat(warehouse.readRows(exact, List.of("payload"))).hasSize(1);

    ResultSet exceeded = mock(ResultSet.class);
    when(exceeded.next()).thenReturn(true, false);
    when(exceeded.getString(1)).thenReturn("x".repeat(WarehousePort.MAX_RESULT_BYTES - 16) + "\n");
    assertThatThrownBy(() -> warehouse.readRows(exceeded, List.of("payload")))
        .isInstanceOfSatisfying(
            Failure.class, error -> assertThat(error.code).isEqualTo("QUERY_RESULT_LIMIT"));
  }

  @Test
  void preservesNullAndExactNumericText() throws Exception {
    ResultSet result = mock(ResultSet.class);
    when(result.next()).thenReturn(true, false);
    when(result.getString(1)).thenReturn("9007199254740993");
    when(result.getString(2)).thenReturn("12345.6700");
    when(result.getString(3)).thenReturn((String) null);
    var rows = warehouse.readRows(result, List.of("id", "amount", "phone"));
    assertThat(rows).hasSize(1);
    assertThat(rows.getFirst())
        .containsEntry("id", "9007199254740993")
        .containsEntry("amount", "12345.6700")
        .containsEntry("phone", null);
  }
}
