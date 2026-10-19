package cn.jiuzhang.platform.execution.application;
import cn.jiuzhang.platform.dataset.application.DatasetService;
import cn.jiuzhang.platform.dataset.application.DatasetStore;
import cn.jiuzhang.platform.dataset.domain.DatasetPlan;
import cn.jiuzhang.platform.dataset.domain.DatasetPlan.Problem;
import cn.jiuzhang.platform.execution.domain.SnapshotPolicy;
import cn.jiuzhang.platform.identity.application.IdentityService;
import cn.jiuzhang.platform.shared.application.Failure;
import cn.jiuzhang.platform.shared.infrastructure.MetadataJson;
import cn.jiuzhang.platform.source.application.SourceService;
import cn.jiuzhang.platform.source.domain.SourceConnector;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.io.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.stereotype.Service;
import static cn.jiuzhang.platform.dataset.application.DatasetService.*;

@Service
public class ExecutionEngine {
 private final RunStore runs;private final DatasetStore datasets;private final DatasetService service;private final SourceService sources;private final SourceConnector connector;private final WarehousePort warehouse;private final ObjectPort objects;private final IdentityService identity;private final MetadataJson json;
 public ExecutionEngine(RunStore runs,DatasetStore datasets,DatasetService service,SourceService sources,SourceConnector connector,WarehousePort warehouse,ObjectPort objects,IdentityService identity,MetadataJson json){this.runs=runs;this.datasets=datasets;this.service=service;this.sources=sources;this.connector=connector;this.warehouse=warehouse;this.objects=objects;this.identity=identity;this.json=json;}
 public boolean next(){var run=runs.claim();if(run==null)return false;execute(run);return true;}
 private void execute(Map<String,Object> run){String id=text(run,"id"),dataset=text(run,"datasetId"),token=text(run,"leaseToken");var version=datasets.version(dataset,integer(run,"datasetVersion"));var d=map(version,"definition");var plan=service.executable(version);
  String physical="jz_s_"+id+"_"+token.replace("-","").substring(0,12),raw="runs/"+id+"/"+token+".ndjson";
  var leaseLost=new AtomicBoolean();var cancelRequested=new AtomicBoolean();var pulse=Executors.newSingleThreadScheduledExecutor();pulse.scheduleAtFixedRate(()->{try{if(!runs.heartbeat(id,token))leaseLost.set(true);cancelRequested.set(runs.canceled(id,token));}catch(Exception e){leaseLost.set(true);}},1,1,TimeUnit.SECONDS);
  Path file=null;boolean publishing=run.get("status").equals("publishing");
  try{
   if(publishing){var snapshot=runs.snapshot(id);publish(id,dataset,token,text(snapshot,"physical"),plan);return;}
   warehouse.create(physical,plan.fields());
   file=Files.createTempFile("jiuzhang-raw-",".ndjson",PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
   long[] count={0},rawBytes={0};long[] failures=new long[plan.quality().size()];var batch=new ArrayList<Map<String,Object>>();long[] batchBytes={0};Instant deadline=Instant.now().plusSeconds(integer(map(d,"schedule"),"timeoutSeconds"));
   try(var writer=Files.newBufferedWriter(file)){
    connector.scan(sources.connection(text(d,"sourceId")),datasets.table(dataset,integer(run,"datasetVersion")),datasets.columns(dataset,integer(run,"datasetVersion")),new ArrayList<>(plan.usedSourceFields()),row->{
     if(leaseLost.get())throw new Failure(409,"RUN_LEASE_LOST");if(Instant.now().isAfter(deadline))throw new Failure(422,"RUN_TIMEOUT");
     String line=json.write(row);rawBytes[0]+=line.getBytes(java.nio.charset.StandardCharsets.UTF_8).length+1;if(rawBytes[0]>268435456)throw new Failure(422,"RAW_BATCH_LIMIT");try{writer.write(line);writer.newLine();}catch(IOException e){throw new Failure(503,"RAW_STORAGE_FAILED");}
     var converted=plan.transform(row);if(converted==null)return;count[0]++;
     for(int i=0;i<plan.quality().size();i++){var q=plan.quality().get(i);if(q.enabled()&&!plan.passes(q,converted))failures[i]++;}
     var output=plan.output(converted);for(var v:output.values())if(v instanceof String s&&s.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>65533)throw new Failure(422,"WAREHOUSE_VALUE_LIMIT");
     batch.add(output);batchBytes[0]+=json.write(output).length()*3L;if(batch.size()>=250||batchBytes[0]>4194304){warehouse.append(physical,plan.fields(),batch);batch.clear();batchBytes[0]=0;}
    },()->leaseLost.get()||cancelRequested.get()||Instant.now().isAfter(deadline));
   }
   if(runs.canceled(id,token))throw new Failure(409,"RUN_CANCELED");warehouse.append(physical,plan.fields(),batch);
   var quality=new ArrayList<Map<String,Object>>();boolean blocked=false;for(int i=0;i<plan.quality().size();i++){var q=plan.quality().get(i);String result=failures[i]==0||!q.enabled()?"PASS":q.severity();blocked|=result.equals("BLOCK");quality.add(Map.of("ruleId",q.id(),"version",q.version(),"result",result,"message","failed="+failures[i]+";total="+count[0]));}
   runs.transition(id,token,"validating",count[0],quality);objects.put(raw,file);
   if(blocked)throw new Failure(422,"QUALITY_BLOCKED");if(warehouse.count(physical)!=count[0])throw new Failure(422,"WAREHOUSE_ROW_COUNT_MISMATCH");
   var current=runs.current(dataset);if(SnapshotPolicy.requiresEmptyApproval(current==null?0:Long.parseLong(text(current,"rowCount")),count[0],(Boolean)run.get("allowEmpty")))throw new Failure(409,"EMPTY_SNAPSHOT_BLOCKED");
   runs.stage(id,token,physical,objects(d,"fields").stream().filter(f->bool(f,"output")).toList(),count[0],raw);publishing=true;publish(id,dataset,token,physical,plan);
  }catch(Exception error){String code=error instanceof Failure f?f.code:error instanceof Problem p?p.code:"EXECUTION_FAILED";
   // An ambiguous view update remains publishing; reconciliation repeats an idempotent assignment.
   if(!publishing){boolean canceled=runs.canceled(id,token);runs.finish(id,token,canceled?"canceled":Set.of("SCHEMA_CHANGED","QUALITY_BLOCKED","EMPTY_SNAPSHOT_BLOCKED").contains(code)?"blocked":"failed",canceled?"RUN_CANCELED":code);try{warehouse.drop(physical);}catch(Exception ignored){}try{objects.delete(raw);}catch(Exception ignored){}}
   else org.slf4j.LoggerFactory.getLogger(ExecutionEngine.class).warn("Run {} awaiting publication reconciliation ({})",id,code);
  }finally{pulse.shutdownNow();if(file!=null)try{Files.deleteIfExists(file);}catch(IOException ignored){}}
 }
 private void publish(String id,String dataset,String token,String physical,DatasetPlan plan){
  // Only this bounded pointer DDL is inside the admission lock, never extraction/load/object I/O.
  runs.transaction(()->{runs.lockDataset(dataset);var locked=runs.get(id,true);if(!token.equals(locked.get("leaseToken"))||!Instant.parse(text(locked,"leaseUntil")).isAfter(Instant.now()))throw new Failure(409,"RUN_LEASE_LOST");String logical=text(map(map(datasets.version(dataset,integer(locked,"datasetVersion")),"definition"),"output"),"table");if(!warehouse.pointsTo(logical,physical))warehouse.publish(logical,physical,plan.fields());if(!warehouse.pointsTo(logical,physical))throw new Failure(503,"PUBLICATION_UNCONFIRMED");runs.commit(id,token);identity.audit(text(locked,"requestedBy"),"snapshot_published","run",id,"worker:"+id);return null;});
  cleanup(dataset);
 }
 public void cleanupAll(){for(var target:runs.targets())try{cleanup(text(target,"datasetId"));}catch(Exception ignored){}}
 private void cleanup(String dataset){var history=runs.history(dataset);var expired=SnapshotPolicy.expiredHistory(history.stream().map(s->new SnapshotPolicy.HistoricalSnapshot(text(s,"runId"),Instant.parse(text(s,"replacedAt")))).toList(),Instant.now());for(String id:expired)runs.transaction(()->{runs.lockDataset(dataset);var snap=runs.snapshot(id);if(snap.get("deletedAt")==null&&snap.get("replacedAt")!=null){warehouse.drop(text(snap,"physical"));runs.deleted(id);}return null;});}
}
