package cn.jiuzhang.platform.execution.infrastructure;

import cn.jiuzhang.platform.execution.application.ObjectPort;
import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.source.application.SourceFileContent;
import java.net.URI;
import java.nio.file.Path;
import java.time.Duration;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.S3Exception;

@Component
public class S3Objects implements ObjectPort, SourceFileContent {
  private volatile boolean ready;
  private final String bucket = System.getenv().getOrDefault("OBJECTS_BUCKET", "jiuzhang-raw");

  private S3Client client() {
    String access = System.getenv("OBJECTS_ACCESS_KEY"), secret = System.getenv("OBJECTS_SECRET_KEY");
    if (access == null || secret == null) throw new Failure(503, "OBJECTS_NOT_CONFIGURED");
    return S3Client.builder()
        .endpointOverride(URI.create(System.getenv().getOrDefault("OBJECTS_ENDPOINT", "http://127.0.0.1:18333")))
        .region(Region.US_EAST_1)
        .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(access, secret)))
        // SeaweedFS 3.97 stores AWS streaming signature framing verbatim. Use a fixed payload.
        .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).chunkedEncodingEnabled(false).build())
        .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
        .overrideConfiguration(c -> c.apiCallTimeout(Duration.ofSeconds(60)).apiCallAttemptTimeout(Duration.ofSeconds(30)))
        .build();
  }

  private void put(String key, RequestBody body, String type) {
    try (var client = client()) {
      if (!ready) {
        try { client.headBucket(b -> b.bucket(bucket)); }
        catch (S3Exception e) { if (e.statusCode() != 404) throw e; client.createBucket(b -> b.bucket(bucket)); }
        ready = true;
      }
      client.putObject(b -> b.bucket(bucket).key(key).contentType(type), body);
    } catch (Failure e) { throw e; }
    catch (Exception e) { throw new Failure(503, "OBJECTS_UNAVAILABLE"); }
  }

  public void put(String key, Path file) { put(key, RequestBody.fromFile(file), "application/x-ndjson"); }
  public void putFile(String key, byte[] content) { put(key, RequestBody.fromBytes(content), "application/octet-stream"); }

  public byte[] readFile(String key) {
    try (var client = client(); var in = client.getObject(b -> b.bucket(bucket).key(key))) {
      if (in.response().contentLength() > 20971520) throw new Failure(422, "EXCEL_LIMIT");
      var bytes = in.readNBytes(20971521);
      if (bytes.length > 20971520) throw new Failure(422, "EXCEL_LIMIT");
      return bytes;
    } catch (Failure e) { throw e; }
    catch (Exception e) { throw new Failure(503, "OBJECTS_UNAVAILABLE"); }
  }

  public void delete(String key) {
    try (var client = client()) { client.deleteObject(b -> b.bucket(bucket).key(key)); }
    catch (Exception e) { throw new Failure(503, "OBJECTS_UNAVAILABLE"); }
  }
}
