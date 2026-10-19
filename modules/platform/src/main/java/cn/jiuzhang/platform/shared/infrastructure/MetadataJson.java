package cn.jiuzhang.platform.shared.infrastructure;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.springframework.stereotype.Component;
/** Shared metadata serializer. Rejected metadata and source values are never logged. */
@Component
public class MetadataJson {
 private final ObjectMapper mapper;
 public MetadataJson(ObjectMapper mapper){this.mapper=mapper;}
 public String write(Object value){try{return mapper.writeValueAsString(value);}catch(Exception e){throw new IllegalStateException("Metadata serialization failed");}}
 public <T>T read(String value,TypeReference<T> type){try{return mapper.readValue(value,type);}catch(Exception e){throw new IllegalStateException("Metadata decoding failed");}}
 public Map<String,Object> object(Object value){return read(value.toString(),new TypeReference<Map<String,Object>>(){});}
}
