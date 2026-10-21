package cn.jiuzhang.platform.execution.application;
import cn.jiuzhang.platform.dataset.application.DatasetStore;
import cn.jiuzhang.platform.identity.application.IdentityService;
import cn.jiuzhang.platform.identity.application.IdentityService.User;
import cn.jiuzhang.platform.shared.application.Failure;
import java.time.*;
import java.util.*;
import org.springframework.stereotype.Service;
@Service
public class RunService{
 private final RunStore store;private final DatasetStore datasets;private final IdentityService identity;
 public RunService(RunStore store,DatasetStore datasets,IdentityService identity){this.store=store;this.datasets=datasets;this.identity=identity;}
 public Map<String,Object> start(User user,String dataset,boolean allow,String key,String retry,String requestId){IdentityService.require(user,"write");if(allow)IdentityService.require(user,"system");if(key==null||!key.matches("[a-zA-Z0-9_.:-]{1,100}"))throw new Failure(422,"IDEMPOTENCY_KEY_REQUIRED");
  return store.transaction(()->{store.lockDataset(dataset);var d=datasets.get(dataset,false);int version=((Number)d.get("publishedVersion")).intValue();if(retry!=null){var old=store.get(retry,false);if(!old.get("datasetId").equals(dataset)||!List.of("failed","blocked","canceled").contains(old.get("status")))throw new Failure(409,"RUN_NOT_RETRYABLE");version=((Number)old.get("datasetVersion")).intValue();}if(version<1)throw new Failure(409,"DATASET_NOT_PUBLISHED");Object savedDefinition=datasets.version(dataset,version).get("definition");if(savedDefinition instanceof Map<?,?> definition&&"direct".equals(definition.get("deliveryMode")))throw new Failure(409,"DATASET_NOT_RUNNABLE");String hash=IdentityService.hash("allow="+allow+";retry="+retry);var existing=store.existing(user.id(),dataset,key);if(existing!=null){if(!existing.get("requestHash").equals(hash))throw new Failure(409,"IDEMPOTENCY_CONFLICT");return view(existing);}
   var run=store.create(dataset,version,user.id(),key,hash,allow,retry);identity.audit(user.id(),allow?"run_allow_empty":"run","dataset",dataset,requestId);return view(run);});
 }
 public Map<String,Object> retry(User user,String id,boolean allow,String key,String request){var old=store.get(id,false);return start(user,old.get("datasetId").toString(),allow,key,id,request);}
 public List<Map<String,Object>> list(User user){IdentityService.require(user,"read");return store.list().stream().map(this::view).toList();}
 public Map<String,Object> get(User user,String id){IdentityService.require(user,"read");return view(store.get(id,false));}
 public Map<String,Object> cancel(User user,String id,String request){IdentityService.require(user,"write");return store.transaction(()->{var r=store.get(id,true);if(!List.of("queued","running","validating").contains(r.get("status")))throw new Failure(409,"RUN_NOT_CANCELABLE");store.cancel(id);identity.audit(user.id(),"cancel","run",id,request);return view(store.get(id,false));});}
 @SuppressWarnings("unchecked") private Map<String,Object> view(Map<String,Object> r){var m=new LinkedHashMap<String,Object>();for(String key:List.of("id","datasetId","datasetVersion","retryOf","status","startedAt","rowCount","logs","qualityResults","errorCode"))m.put(key,r.get(key));for(String key:List.of("finishedAt","executionStartedAt"))m.put(key,r.get(key));String status=r.get("status").toString();m.put("outcome",status.equals("blocked")?"blocked":status.equals("failed")?"failed":"succeeded");m.put("taskId","");m.put("trigger",r.get("retryOf").toString().isEmpty()?"manual":"retry");m.put("businessDate",null);m.put("durationMs",Duration.between(Instant.parse(r.get("startedAt").toString()),r.get("finishedAt")==null?Instant.now():Instant.parse(r.get("finishedAt").toString())).toMillis());m.put("outputTableId",status.equals("succeeded")?r.get("datasetId"):"");m.put("scheduleSnapshot",((Map<String,Object>)datasets.version(r.get("datasetId").toString(),((Number)r.get("datasetVersion")).intValue()).get("definition")).get("schedule"));m.put("waitReason","");return m;}
}
