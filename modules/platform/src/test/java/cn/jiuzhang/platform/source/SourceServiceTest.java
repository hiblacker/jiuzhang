package cn.jiuzhang.platform.source;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import cn.jiuzhang.platform.identity.application.IdentityService;
import cn.jiuzhang.platform.shared.application.JsonWriter;
import cn.jiuzhang.platform.source.application.*;
import cn.jiuzhang.platform.source.domain.SourceConnector;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;

class SourceServiceTest {
  @Test void acceptsOceanBaseAndPreservesTheFullAccount() {
    var connector=mock(SourceConnector.class);
    when(connector.type()).thenReturn("OceanBase");
    var mysql=mock(SourceConnector.class);when(mysql.type()).thenReturn("MySQL");
    var service=new SourceService(mock(SourceStore.class),mock(SecretVault.class),List.of(mysql,connector),
        mock(IdentityService.class),mock(ExcelSourceService.class),mock(JsonWriter.class));
    var user=new IdentityService.User("1","synthetic","test","admin",true,Instant.EPOCH);
    var draft=new SourceService.Draft("ob","","test",List.of(),"OceanBase",
        Map.of("host","127.0.0.1","port",2881,"database","demo_retail","tls",false),
        new SourceService.Credentials("reader@tenant#cluster","synthetic-password"));
    assertThatCode(()->service.test(user,draft,null,"test")).doesNotThrowAnyException();
    verify(connector).test(new SourceConnector.Connection("127.0.0.1",2881,"demo_retail",false,
        "reader@tenant#cluster","synthetic-password"));
    verify(mysql,never()).test(any());
  }
}
