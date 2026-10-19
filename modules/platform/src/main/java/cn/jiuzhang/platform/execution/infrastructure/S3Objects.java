package cn.jiuzhang.platform.execution.infrastructure;
import cn.jiuzhang.platform.execution.application.ObjectPort;
import cn.jiuzhang.platform.shared.application.Failure;
import java.net.URI;
import java.nio.file.Path;
import java.time.Duration;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.core.sync.RequestBody;
import org.springframework.stereotype.Component;
@Component
public class S3Objects implements ObjectPort {
 private volatile boolean ready;
 private final String bucket=System.getenv().getOrDefault("OBJECTS_BUCKET","jiuzhang-raw");
 private S3Client client(){String access=System.getenv("OBJECTS_ACCESS_KEY"),secret=System.getenv("OBJECTS_SECRET_KEY");if(access==null||secret==null)throw new Failure(503,"OBJECTS_NOT_CONFIGURED");return S3Client.builder().endpointOverride(URI.create(System.getenv().getOrDefault("OBJECTS_ENDPOINT","http://127.0.0.1:18333"))).region(Region.US_EAST_1).credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(access,secret))).serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build()).overrideConfiguration(c->c.apiCallTimeout(Duration.ofSeconds(60)).apiCallAttemptTimeout(Duration.ofSeconds(30))).build();}
 public void put(String key,Path file){try(var c=client()){if(!ready){try{c.headBucket(b->b.bucket(bucket));}catch(S3Exception e){if(e.statusCode()!=404)throw e;c.createBucket(b->b.bucket(bucket));}ready=true;}c.putObject(b->b.bucket(bucket).key(key).contentType("application/x-ndjson"),RequestBody.fromFile(file));}catch(Exception e){throw new Failure(503,"OBJECTS_UNAVAILABLE");}}
 public void delete(String key){try(var c=client()){c.deleteObject(b->b.bucket(bucket).key(key));}catch(Exception e){throw new Failure(503,"OBJECTS_UNAVAILABLE");}}
}
