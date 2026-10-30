import cn.jiuzhang.platform.execution.infrastructure.S3Objects;
import cn.jiuzhang.platform.source.application.*;
import cn.jiuzhang.platform.source.infrastructure.JdbcSourceFileStore;
import cn.jiuzhang.platform.source.infrastructure.PoiExcelReader;
import cn.jiuzhang.platform.shared.application.Failure;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** Actual binary storage, reference retention and durable cleanup failure/retry. */
class ExcelSourceAcceptance {
  static void require(boolean value,String message) { if(!value) throw new AssertionError(message); }
  public static void main(String[] args) throws Exception {
    var jdbc=new JdbcTemplate(new DriverManagerDataSource(
        System.getenv().getOrDefault("METADATA_URL","jdbc:postgresql://127.0.0.1:15432/jiuzhang"),
        System.getenv().getOrDefault("METADATA_USER","jiuzhang"),System.getenv("METADATA_PASSWORD")));
    var files=new JdbcSourceFileStore(jdbc);
    var fixture=new ObjectMapper().readTree(Path.of(".local/excel-test.json").toFile());
    var frozen=files.get(fixture.get("fileId").asText());
    require(!files.deleteUnused(frozen.id()),"A published file must not be reclaimed after source replacement");
    var content=new S3Objects();
    var bytes=Files.readAllBytes(Path.of(".local/excel-source-fixture.xlsx"));
    String key="source-files/storage-probe-"+UUID.randomUUID();
    var unused=files.create(frozen.ownerId(),"synthetic.xlsx",key,bytes.length);
    content.putFile(key,bytes);
    require(Arrays.equals(bytes,content.readFile(key)),"S3 changed Excel bytes");
    var raw=Files.createTempFile(Path.of(".local"),"raw-roundtrip-",".ndjson");
    String rawKey="runs/storage-probe-"+UUID.randomUUID()+".ndjson";
    try {
      Files.writeString(raw,"{\"synthetic\":\"exact\"}\n");content.put(rawKey,raw);
      require(Arrays.equals(Files.readAllBytes(raw),content.readFile(rawKey)),"S3 changed execution batch bytes");
    } finally { content.delete(rawKey);Files.deleteIfExists(raw); }
    jdbc.update("UPDATE source_file SET created_at=now()-interval '2 days' WHERE id=?",Long.parseLong(unused.id()));
    boolean[] fail={true};
    SourceFileContent intermittent=new SourceFileContent() {
      public void putFile(String k,byte[] b) { content.putFile(k,b); }
      public byte[] readFile(String k) { return content.readFile(k); }
      public void delete(String k) { if(k.equals(key)&&fail[0])throw new Failure(503,"OBJECTS_UNAVAILABLE");content.delete(k); }
    };
    var service=new ExcelSourceService(files,intermittent,new PoiExcelReader(),null,null);
    try { service.cleanup();throw new AssertionError("Failure injection was not reached"); }
    catch(Failure expected) { require(expected.code.equals("OBJECTS_UNAVAILABLE"),"Unexpected failure"); }
    require(files.pendingDeletes().contains(key),"Failed object deletion lost its durable retry record");
    fail[0]=false;service.cleanup();
    require(!files.pendingDeletes().contains(key),"Successful retry did not acknowledge deletion");
    require(files.get(frozen.id()).id().equals(frozen.id()),"Cleanup deleted a frozen source file");
    System.out.println("PASS real S3/PostgreSQL: exact Excel and NDJSON bytes, published-file retention, durable cleanup failure/retry");
  }
}
